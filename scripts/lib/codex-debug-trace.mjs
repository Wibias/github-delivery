import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const TRACE_KIND = "github-delivery/codex-debug-trace-event";
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

function sanitizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  const type = cleanString(event.type);
  if (!type || !ALLOWED_EVENT_TYPES.has(type)) return null;

  const sanitized = {
    schemaVersion: 1,
    kind: TRACE_KIND,
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
    throw new Error(`Refusing debug trace directory not owned by the current user: ${path}`);
  }
}

function ensurePrivateDirectory(path, label) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked ${label}: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Debug trace path is not a directory: ${path}`);
  }
  assertOwnedByCurrentUser(stat, path);
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

function safeTimestamp(value) {
  return value.toISOString().replace(/[:.]/g, "-");
}

function openTraceFile(directory, timestamp, pid) {
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const extra = suffix === 0 ? "" : `-${suffix}`;
    const path = join(directory, `codex-${timestamp}-${pid}${extra}.jsonl`);
    try {
      return { path, fd: openSync(path, "wx", 0o600) };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("codex_debug_trace_path_exhausted");
}

export function debugTraceEnabled(env = process.env) {
  const value = String(env?.GITHUB_DELIVERY_DEBUG_TRACE || "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export function createCodexDebugTraceRecorder({
  env = process.env,
  stateDir = null,
  now = () => new Date(),
  pid = process.pid,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!debugTraceEnabled(env)) {
    return {
      enabled: false,
      path: null,
      record() {},
      close() {},
    };
  }

  const byteLimit = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
  const root = traceRoot(env, stateDir);
  const directory = join(root, "debug-traces");
  ensurePrivateDirectory(root, "debug trace state directory");
  ensurePrivateDirectory(directory, "debug trace directory");

  const opened = openTraceFile(directory, safeTimestamp(now()), pid);
  if (process.platform !== "win32") chmodSync(opened.path, 0o600);

  let fd = opened.fd;
  let bytesWritten = 0;

  function record(event) {
    if (fd === null) return;
    const sanitized = sanitizeEvent(event);
    if (!sanitized) return;
    const line = `${JSON.stringify(sanitized)}\n`;
    const bytes = Buffer.byteLength(line);
    if (bytesWritten + bytes > byteLimit) return;
    writeSync(fd, line, null, "utf8");
    bytesWritten += bytes;
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
