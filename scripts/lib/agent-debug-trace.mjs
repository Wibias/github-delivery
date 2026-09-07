import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const TRACE_KIND = "github-delivery/agent-debug-trace-event";
const PROVIDERS = new Set(["codex", "grok", "cursor"]);
const ALLOWED_EVENT_TYPES = new Set([
  "reasoning_summary_delta",
  "item_started",
  "item_completed",
  "turn_started",
  "turn_completed",
]);

function cleanString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function checkedProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!PROVIDERS.has(provider)) throw new Error(`unsupported_agent_debug_trace_provider:${provider || "missing"}`);
  return provider;
}

function sanitizeEvent(event, provider, traceKind = TRACE_KIND) {
  if (!event || typeof event !== "object") return null;
  const type = cleanString(event.type);
  if (!type || !ALLOWED_EVENT_TYPES.has(type)) return null;

  const sanitized = {
    schemaVersion: 1,
    kind: traceKind,
    provider,
    type,
  };

  for (const key of ["threadId", "turnId", "itemId", "itemType"]) {
    const value = cleanString(event[key]);
    if (value) sanitized[key] = value;
  }

  if (type === "reasoning_summary_delta") {
    sanitized.text = typeof event.text === "string" ? event.text : "";
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
} = {}) {
  if (!debugTraceEnabled(env)) return disabledRecorder();

  const normalizedProvider = checkedProvider(provider);
  const limit = byteLimit(maxBytes);
  const root = traceRoot(env, stateDir);
  const directory = join(root, "debug-traces");
  ensurePrivateDirectory(root, "debug trace state directory");
  ensurePrivateDirectory(directory, "debug trace directory");

  const opened = openTraceFile(directory, normalizedProvider, safeTimestamp(now()), pid);
  if (process.platform !== "win32") chmodSync(opened.path, 0o600);

  let fd = opened.fd;
  let bytesWritten = 0;

  function record(event) {
    if (fd === null) return false;
    const sanitized = sanitizeEvent(event, normalizedProvider, traceKind);
    if (!sanitized) return false;
    const line = `${JSON.stringify(sanitized)}\n`;
    const bytes = Buffer.byteLength(line);
    if (bytesWritten + bytes > limit) return false;
    writeSync(fd, line, null, "utf8");
    bytesWritten += bytes;
    return true;
  }

  function close() {
    if (fd === null) return;
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
  maxBytes = DEFAULT_MAX_BYTES,
  traceKind = TRACE_KIND,
} = {}) {
  if (!debugTraceEnabled(env)) return { recorded: false, path: null };
  const normalizedProvider = checkedProvider(provider);
  const scope = cleanString(scopeId);
  if (!scope) return { recorded: false, path: null };
  const sanitized = sanitizeEvent(event, normalizedProvider, traceKind);
  if (!sanitized) return { recorded: false, path: null };

  const root = traceRoot(env, stateDir);
  const directory = join(root, "debug-traces");
  ensurePrivateDirectory(root, "debug trace state directory");
  ensurePrivateDirectory(directory, "debug trace directory");
  const digest = createHash("sha256").update(scope).digest("hex");
  const path = join(directory, `${normalizedProvider}-hook-${digest}.jsonl`);
  const existing = existingRegularFile(path);
  const line = `${JSON.stringify(sanitized)}\n`;
  const bytes = Buffer.byteLength(line);
  const currentBytes = existing?.size || 0;
  if (currentBytes + bytes > byteLimit(maxBytes)) return { recorded: false, path };

  const fd = openSync(path, "a", 0o600);
  try {
    const postOpen = statSync(path);
    assertOwnedByCurrentUser(postOpen, path);
    if (!postOpen.isFile()) throw new Error(`Debug trace path is not a regular file: ${path}`);
    writeSync(fd, line, null, "utf8");
  } finally {
    closeSync(fd);
  }
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return { recorded: true, path };
}
