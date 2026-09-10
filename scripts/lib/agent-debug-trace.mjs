import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_REASONING_COALESCE_BYTES = 16 * 1024;
const TRACE_KIND = "github-delivery/agent-debug-trace-event";
const PROVIDERS = new Set(["codex", "grok", "cursor"]);
const ALLOWED_EVENT_TYPES = new Set([
  "trace_metadata",
  "reasoning_summary_delta",
  "item_started",
  "item_completed",
  "turn_started",
  "turn_completed",
]);
const ALLOWED_OUTCOMES = new Set(["succeeded", "failed", "cancelled"]);
const ERROR_KIND_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
const ATTRIBUTION_KEYS = ["threadId", "turnId", "itemId", "parentItemId"];
const USAGE_KEYS = [
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
];

function packageVersion() {
  try {
    const packageUrl = new URL("../../package.json", import.meta.url);
    return String(JSON.parse(readFileSync(packageUrl, "utf8"))?.version || "").trim() || null;
  } catch {
    return null;
  }
}

function traceImplementationDigest() {
  try {
    const bytes = readFileSync(fileURLToPath(import.meta.url));
    return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  } catch {
    return null;
  }
}

const GITHUB_DELIVERY_VERSION = packageVersion();
const TRACE_IMPLEMENTATION_DIGEST = traceImplementationDigest();

function cleanString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function checkedProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!PROVIDERS.has(provider)) throw new Error(`unsupported_agent_debug_trace_provider:${provider || "missing"}`);
  return provider;
}

function safeDuration(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function safeTokenCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function safeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = {};
  for (const key of USAGE_KEYS) {
    const count = safeTokenCount(value[key]);
    if (count !== null) usage[key] = count;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function safeOutcome(value) {
  const outcome = String(value || "").trim().toLowerCase();
  return ALLOWED_OUTCOMES.has(outcome) ? outcome : null;
}

function safeErrorKind(value) {
  const kind = String(value || "").trim();
  return ERROR_KIND_RE.test(kind) ? kind : null;
}

function createIdPseudonymizer(salt) {
  const key = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt || ""), "utf8");
  return (value) => {
    const text = cleanString(value);
    if (!text) return null;
    const digest = createHash("sha256")
      .update(key)
      .update("\0")
      .update(text, "utf8")
      .digest("hex")
      .slice(0, 24);
    return `id:${digest}`;
  };
}

function traceMetadata(provider, env, traceKind = TRACE_KIND) {
  const metadata = {
    schemaVersion: 1,
    kind: traceKind,
    provider,
    type: "trace_metadata",
  };
  if (GITHUB_DELIVERY_VERSION) metadata.githubDeliveryVersion = GITHUB_DELIVERY_VERSION;
  if (TRACE_IMPLEMENTATION_DIGEST) metadata.traceImplementationDigest = TRACE_IMPLEMENTATION_DIGEST;
  const commit = cleanString(env?.GITHUB_DELIVERY_BUILD_COMMIT);
  if (commit) metadata.githubDeliveryCommit = commit;
  const workflow = cleanString(env?.GITHUB_DELIVERY_WORKFLOW);
  if (workflow) metadata.workflow = workflow;
  return metadata;
}

function sanitizeEvent(
  event,
  provider,
  traceKind = TRACE_KIND,
  timestamp = new Date(),
  pseudonymizeId = createIdPseudonymizer("default"),
) {
  if (!event || typeof event !== "object") return null;
  const type = cleanString(event.type);
  if (!type || !ALLOWED_EVENT_TYPES.has(type)) return null;

  if (type === "trace_metadata") {
    return {
      ...traceMetadata(provider, event.env || {}, traceKind),
      timestamp: timestamp.toISOString(),
      ...(cleanString(event.githubDeliveryVersion)
        ? { githubDeliveryVersion: event.githubDeliveryVersion }
        : {}),
      ...(cleanString(event.traceImplementationDigest)
        ? { traceImplementationDigest: event.traceImplementationDigest }
        : {}),
      ...(cleanString(event.githubDeliveryCommit)
        ? { githubDeliveryCommit: event.githubDeliveryCommit }
        : {}),
      ...(cleanString(event.workflow) ? { workflow: event.workflow } : {}),
    };
  }

  const sanitized = {
    schemaVersion: 1,
    kind: traceKind,
    provider,
    type,
    timestamp: timestamp.toISOString(),
  };

  for (const key of ATTRIBUTION_KEYS) {
    const value = pseudonymizeId(event[key]);
    if (value) sanitized[key] = value;
  }
  const itemType = cleanString(event.itemType);
  if (itemType) sanitized.itemType = itemType;

  if (type === "reasoning_summary_delta") {
    sanitized.text = typeof event.text === "string" ? event.text : "";
  }

  if (type === "item_completed") {
    const outcome = safeOutcome(event.outcome);
    const durationMs = safeDuration(event.durationMs);
    const errorKind = safeErrorKind(event.errorKind);
    if (outcome) sanitized.outcome = outcome;
    if (durationMs !== null) sanitized.durationMs = durationMs;
    if (errorKind) sanitized.errorKind = errorKind;
  }

  if (type === "turn_completed") {
    const usage = safeUsage(event.usage);
    if (usage) sanitized.usage = usage;
  }

  const decision = cleanString(event.watchdogDecision);
  if (decision) sanitized.watchdogDecision = decision;
  if (typeof event.interrupted === "boolean") sanitized.interrupted = event.interrupted;

  return sanitized;
}

function traceRoot(env, stateDir) {
  const root = stateDir || env.GITHUB_DELIVERY_STATE_DIR || join(homedir(), ".github-delivery");
  return resolve(root);
}

function assertOwnedByCurrentUser(stat, path) {
  if (typeof process.getuid !== "function") return;
  if (stat.uid !== process.getuid()) {
    throw new Error(`Refusing debug trace path not owned by the current user: ${path}`);
  }
}

function ensurePrivateDirectory(path, label) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlinked ${label}: ${path}`);
  if (!stat.isDirectory()) throw new Error(`Debug trace path is not a directory: ${path}`);
  assertOwnedByCurrentUser(stat, path);
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

function existingRegularFile(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlinked debug trace file: ${path}`);
  if (!stat.isFile()) throw new Error(`Debug trace path is not a regular file: ${path}`);
  assertOwnedByCurrentUser(stat, path);
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return stat;
}

function safeTimestamp(value) {
  return value.toISOString().replace(/[:.]/g, "-");
}

function openTraceFile(directory, provider, timestamp, pid) {
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const extra = suffix === 0 ? "" : `-${suffix}`;
    const path = join(directory, `${provider}-${timestamp}-${pid}${extra}.jsonl`);
    try {
      return { path, fd: openSync(path, "wx", 0o600) };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("agent_debug_trace_path_exhausted");
}

function byteLimit(value) {
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_BYTES;
}

function reasoningIdentity(event) {
  return [
    event.threadId || "",
    event.turnId || "",
    event.itemId || "",
    event.parentItemId || "",
  ].join("\0");
}

function disabledRecorder() {
  return {
    enabled: false,
    path: null,
    record() {},
    close() {},
  };
}

export function debugTraceEnabled(env = process.env) {
  const value = String(env?.GITHUB_DELIVERY_DEBUG_TRACE || "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export function createAgentDebugTraceRecorder({
  provider,
  env = process.env,
  stateDir = null,
  now = () => new Date(),
  pid = process.pid,
  maxBytes = DEFAULT_MAX_BYTES,
  traceKind = TRACE_KIND,
  reasoningCoalesceBytes = DEFAULT_REASONING_COALESCE_BYTES,
  idSalt = randomBytes(32),
} = {}) {
  if (!debugTraceEnabled(env)) return disabledRecorder();

  const normalizedProvider = checkedProvider(provider);
  const limit = byteLimit(maxBytes);
  const coalesceLimit = byteLimit(reasoningCoalesceBytes);
  const root = traceRoot(env, stateDir);
  const directory = join(root, "debug-traces");
  ensurePrivateDirectory(root, "debug trace state directory");
  ensurePrivateDirectory(directory, "debug trace directory");

  const opened = openTraceFile(directory, normalizedProvider, safeTimestamp(now()), pid);
  if (process.platform !== "win32") chmodSync(opened.path, 0o600);

  let fd = opened.fd;
  let bytesWritten = 0;
  let pendingReasoning = null;
  const pseudonymizeId = createIdPseudonymizer(idSalt);

  function writeSanitized(sanitized) {
    if (fd === null) return false;
    const line = `${JSON.stringify(sanitized)}\n`;
    const bytes = Buffer.byteLength(line);
    if (bytesWritten + bytes > limit) return false;
    writeSync(fd, line, null, "utf8");
    bytesWritten += bytes;
    return true;
  }

  writeSanitized({
    ...traceMetadata(normalizedProvider, env, traceKind),
    timestamp: now().toISOString(),
  });

  function flushReasoning() {
    if (!pendingReasoning) return true;
    const pending = pendingReasoning;
    pendingReasoning = null;
    return writeSanitized(pending);
  }

  function record(event) {
    if (fd === null) return false;
    const sanitized = sanitizeEvent(
      event,
      normalizedProvider,
      traceKind,
      now(),
      pseudonymizeId,
    );
    if (!sanitized) return false;

    if (sanitized.type === "reasoning_summary_delta") {
      const identity = reasoningIdentity(sanitized);
      if (pendingReasoning && reasoningIdentity(pendingReasoning) === identity) {
        const combined = `${pendingReasoning.text}${sanitized.text}`;
        if (Buffer.byteLength(combined, "utf8") <= coalesceLimit) {
          pendingReasoning.text = combined;
          pendingReasoning.deltaCount += 1;
          return true;
        }
      }
      flushReasoning();
      pendingReasoning = { ...sanitized, deltaCount: 1 };
      return true;
    }

    flushReasoning();
    return writeSanitized(sanitized);
  }

  function close() {
    if (fd === null) return;
    flushReasoning();
    closeSync(fd);
    fd = null;
  }

  return {
    enabled: true,
    path: opened.path,
    record,
    close,
  };
}

export function appendAgentDebugTraceEvent({
  provider,
  scopeId,
  event,
  env = process.env,
  stateDir = null,
  now = () => new Date(),
  maxBytes = DEFAULT_MAX_BYTES,
  traceKind = TRACE_KIND,
} = {}) {
  if (!debugTraceEnabled(env)) return { recorded: false, path: null };
  const normalizedProvider = checkedProvider(provider);
  const scope = cleanString(scopeId);
  if (!scope) return { recorded: false, path: null };
  const scopeDigest = createHash("sha256").update(scope).digest();
  const pseudonymizeId = createIdPseudonymizer(scopeDigest);
  const sanitized = sanitizeEvent(
    event,
    normalizedProvider,
    traceKind,
    now(),
    pseudonymizeId,
  );
  if (!sanitized) return { recorded: false, path: null };

  const root = traceRoot(env, stateDir);
  const directory = join(root, "debug-traces");
  ensurePrivateDirectory(root, "debug trace state directory");
  ensurePrivateDirectory(directory, "debug trace directory");
  const digest = createHash("sha256").update(scope).digest("hex");
  const path = join(directory, `${normalizedProvider}-hook-${digest}.jsonl`);
  const existing = existingRegularFile(path);
  const records = existing
    ? [sanitized]
    : [
        {
          ...traceMetadata(normalizedProvider, env, traceKind),
          timestamp: now().toISOString(),
        },
        sanitized,
      ];
  const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  const bytes = Buffer.byteLength(payload);
  const currentBytes = existing?.size || 0;
  if (currentBytes + bytes > byteLimit(maxBytes)) return { recorded: false, path };

  const fd = openSync(path, "a", 0o600);
  try {
    const postOpen = statSync(path);
    assertOwnedByCurrentUser(postOpen, path);
    if (!postOpen.isFile()) throw new Error(`Debug trace path is not a regular file: ${path}`);
    writeSync(fd, payload, null, "utf8");
  } finally {
    closeSync(fd);
  }
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return { recorded: true, path };
}
