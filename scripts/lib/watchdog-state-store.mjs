import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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

function acquireLock(lockPath, { lockWaitMs, staleLockMs }) {
  const started = Date.now();
  while (true) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      closeSync(fd);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age >= staleLockMs) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - started >= lockWaitMs) {
        throw new Error(`Timed out acquiring watchdog state lock: ${lockPath}`);
      }
      sleep(LOCK_RETRY_MS);
    }
  }
}

function readState(path) {
  if (!existsSync(path)) return {};
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
  writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tempPath, path);
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
  const statePath = watchdogStatePath(stateRoot, scope);
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  const lockPath = `${statePath}.lock`;
  const lockOptions = {
    lockWaitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
    staleLockMs: options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
  };

  acquireLock(lockPath, lockOptions);
  try {
    const prior = readState(statePath);
    const result = reducer(prior);
    if (!result || typeof result !== "object" || !Object.hasOwn(result, "state")) {
      throw new Error("watchdog state reducer must return an object with state");
    }
    atomicWrite(statePath, result.state);
    return { ...result, statePath };
  } finally {
    rmSync(lockPath, { force: true });
  }
}

export function removeWatchdogSessionState(stateRoot, sessionId) {
  const directory = sessionStateDirectory(stateRoot, sessionId);
  const existed = existsSync(directory);
  rmSync(directory, { recursive: true, force: true });
  return { existed, directory };
}
