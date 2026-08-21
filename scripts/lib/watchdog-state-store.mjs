import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const DEFAULT_LOCK_WAIT_MS = 750;
const DEFAULT_STALE_LOCK_MS = 15_000;
const LOCK_RETRY_MS = 10;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function safeAgentId(input = {}) {
  return input.agent_id || input.agentId || "main";
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function assertOwnedByCurrentUser(stat, path) {
  const uid = currentUid();
  if (uid !== null && stat.uid !== uid) {
    throw new Error(`Refusing watchdog state path not owned by the current user: ${path}`);
  }
}

function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked watchdog state directory: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Watchdog state path is not a directory: ${path}`);
  }
  assertOwnedByCurrentUser(stat, path);
  if (process.platform !== "win32") chmodSync(path, 0o700);
}

function safeExistingFile(path, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked watchdog ${label}: ${path}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Watchdog ${label} is not a regular file: ${path}`);
  }
  assertOwnedByCurrentUser(stat, path);
  return stat;
}

export function watchdogStateScope(input = {}) {
  const sessionId = String(input.session_id || "unknown-session");
  const turnId = String(input.turn_id || "unknown-turn");
  const agentId = String(safeAgentId(input));
  return { sessionId, turnId, agentId };
}

export function sessionStateDirectory(stateRoot, sessionId) {
  return join(resolve(stateRoot), hash(sessionId));
}

export function watchdogStatePath(stateRoot, scope) {
  const directory = sessionStateDirectory(stateRoot, scope.sessionId);
  return join(directory, `${hash(`${scope.turnId}\0${scope.agentId}`)}.json`);
}

function sleep(ms) {
  Atomics.wait(sleeper, 0, 0, ms);
}

function createLockToken() {
  return `${process.pid}-${randomBytes(16).toString("hex")}`;
}

function readLockToken(lockPath) {
  const stat = safeExistingFile(lockPath, "lock file");
  if (!stat) return null;
  return { stat, token: readFileSync(lockPath, "utf8").trim() };
}

function createExclusiveLock(lockPath, token) {
  const fd = openSync(lockPath, "wx", 0o600);
  try {
    writeFileSync(fd, `${token}\n`);
  } finally {
    closeSync(fd);
  }
}

function ownsLock(lockPath, token) {
  try {
    return readFileSync(lockPath, "utf8").trim() === token;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertOwnsLock(lockPath, token) {
  if (!ownsLock(lockPath, token)) {
    throw new Error(`lost watchdog state lock: ${lockPath}`);
  }
}

function releaseLock(lockPath, token) {
  try {
    if (!ownsLock(lockPath, token)) return;
    rmSync(lockPath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function acquireLock(lockPath, { lockWaitMs, staleLockMs }) {
  const token = createLockToken();
  const started = Date.now();
  while (true) {
    let contentionError;
    try {
      createExclusiveLock(lockPath, token);
      return token;
    } catch (error) {
      const retryable = error?.code === "EEXIST"
        || (process.platform === "win32" && error?.code === "EPERM");
      if (!retryable) throw error;
      contentionError = error;
    }

    try {
      const existing = readLockToken(lockPath);
      if (existing) {
        const age = Date.now() - existing.stat.mtimeMs;
        if (age >= staleLockMs) {
          try {
            const current = readFileSync(lockPath, "utf8").trim();
            if (current === existing.token) {
              rmSync(lockPath, { force: true });
            }
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          continue;
        }
      }
    } catch (statError) {
      if (statError?.code !== "ENOENT") throw statError;
    }

    if (Date.now() - started >= lockWaitMs) {
      throw new Error(`Timed out acquiring watchdog state lock: ${lockPath}`, { cause: contentionError });
    }
    sleep(LOCK_RETRY_MS);
  }
}

function readState(path) {
  const stat = safeExistingFile(path, "state file");
  if (!stat) return {};
  if (process.platform !== "win32") chmodSync(path, 0o600);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Malformed watchdog state at ${path}: ${error?.message || error}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Malformed watchdog state at ${path}: root must be an object`);
  }
  return parsed;
}

function atomicWrite(path, state) {
  const tempPath = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const payload = `${JSON.stringify(state)}\n`;
  writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    safeExistingFile(path, "state file");
    renameSync(tempPath, path);
    if (process.platform !== "win32") chmodSync(path, 0o600);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function withWatchdogState(scope, reducer, options = {}) {
  if (!scope?.sessionId || !scope?.turnId || !scope?.agentId) {
    throw new Error("watchdog state scope requires sessionId, turnId, and agentId");
  }
  if (typeof reducer !== "function") throw new Error("watchdog state reducer is required");

  const stateRoot = resolve(options.stateRoot);
  ensurePrivateDirectory(stateRoot);
  const statePath = watchdogStatePath(stateRoot, scope);
  ensurePrivateDirectory(dirname(statePath));
  const lockPath = `${statePath}.lock`;
  const lockOptions = {
    lockWaitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
    staleLockMs: options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
  };

  const token = acquireLock(lockPath, lockOptions);
  try {
    const prior = readState(statePath);
    const result = reducer(prior);
    if (!result || typeof result !== "object" || !Object.hasOwn(result, "state")) {
      throw new Error("watchdog state reducer must return an object with state");
    }
    assertOwnsLock(lockPath, token);
    atomicWrite(statePath, result.state);
    return { ...result, statePath };
  } finally {
    releaseLock(lockPath, token);
  }
}

export function removeWatchdogSessionState(stateRoot, sessionId) {
  const root = resolve(stateRoot);
  ensurePrivateDirectory(root);
  const directory = sessionStateDirectory(root, sessionId);
  let stat;
  try {
    stat = lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return { existed: false, directory };
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked watchdog session directory: ${directory}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Watchdog session state path is not a directory: ${directory}`);
  }
  assertOwnedByCurrentUser(stat, directory);
  rmSync(directory, { recursive: true, force: true });
  return { existed: true, directory };
}
