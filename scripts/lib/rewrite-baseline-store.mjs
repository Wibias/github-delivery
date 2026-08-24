import { randomBytes } from "node:crypto";
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
import { dirname, join } from "node:path";

import { userConfigPath } from "./user-config.mjs";

const DEFAULT_LOCK_WAIT_MS = 5_000;
const DEFAULT_STALE_LOCK_MS = 15_000;
const LOCK_RETRY_MS = 10;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name}_required`);
  }
  return value;
}

function exactSha(value, name) {
  const sha = String(required(value, name)).toLowerCase();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`${name}_invalid`);
  return sha;
}

function sleep(ms) {
  Atomics.wait(sleeper, 0, 0, ms);
}

function lockContended(error) {
  return error?.code === "EEXIST" || (process.platform === "win32" && error?.code === "EPERM");
}

function createLockToken() {
  return `${process.pid}-${randomBytes(16).toString("hex")}`;
}

function createExclusiveLock(lockPath, lease) {
  const fd = openSync(lockPath, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(lease)}\n`);
  } finally {
    closeSync(fd);
  }
}

function readLease(lockPath) {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Number.isInteger(parsed.generation) ||
      typeof parsed.token !== "string" ||
      !parsed.token
    ) {
      return null;
    }
    return { generation: parsed.generation, token: parsed.token };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

function ownsLock(lockPath, lease) {
  const current = readLease(lockPath);
  return Boolean(
    current && lease && current.generation === lease.generation && current.token === lease.token,
  );
}

function releaseLock(lockPath, lease) {
  try {
    if (!ownsLock(lockPath, lease)) return;
    rmSync(lockPath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function assertOwnsLock(lockPath, lease) {
  if (!ownsLock(lockPath, lease)) {
    throw new Error(`rewrite_baseline_store_lock_lost:${lockPath}`);
  }
}

function acquireLock(lockPath, { lockWaitMs, staleLockMs }) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const started = Date.now();
  let nextGeneration = 1;
  while (true) {
    const lease = { generation: nextGeneration, token: createLockToken() };
    let contentionError;
    try {
      createExclusiveLock(lockPath, lease);
      return lease;
    } catch (error) {
      if (!lockContended(error)) throw error;
      contentionError = error;
    }

    try {
      const existing = readLease(lockPath);
      if (existing) {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age >= staleLockMs) {
          const current = readLease(lockPath);
          if (
            current &&
            current.generation === existing.generation &&
            current.token === existing.token
          ) {
            nextGeneration = existing.generation + 1;
            rmSync(lockPath, { force: true });
          }
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    if (Date.now() - started >= lockWaitMs) {
      throw new Error(`rewrite_baseline_store_lock_timeout:${lockPath}`, {
        cause: contentionError,
      });
    }
    sleep(LOCK_RETRY_MS);
  }
}

function withStoreLock(lockPath, options, fn) {
  const lease = acquireLock(lockPath, {
    lockWaitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
    staleLockMs: options.staleLockMs ?? DEFAULT_STALE_LOCK_MS,
  });
  try {
    const result = fn(lease);
    assertOwnsLock(lockPath, lease);
    return result;
  } finally {
    releaseLock(lockPath, lease);
  }
}

export function rewriteBaselineScopeKey({ repo, remote, branch }) {
  return `${String(required(repo, "repo")).toLowerCase()}\n${required(remote, "remote")}\n${required(branch, "branch")}`;
}

export function rewriteBaselineStorePath(options = {}) {
  return join(dirname(userConfigPath(options)), "rewrite-baselines.json");
}

function createStore(readAll, writeAll) {
  return {
    read(scope) {
      const value = readAll()[rewriteBaselineScopeKey(scope)];
      if (value == null) return null;
      return exactSha(value, "original_local_tip_baseline");
    },
    create(scope, originalLocalTip) {
      const data = readAll();
      const key = rewriteBaselineScopeKey(scope);
      if (data[key]) throw new Error("rewrite_baseline_already_exists");
      data[key] = exactSha(originalLocalTip, "original_local_tip");
      writeAll(data);
      return data[key];
    },
    consume(scope) {
      const data = readAll();
      const key = rewriteBaselineScopeKey(scope);
      const value = data[key];
      if (value == null) return null;
      const sha = exactSha(value, "original_local_tip_baseline");
      delete data[key];
      writeAll(data);
      return sha;
    },
  };
}

export function createMemoryRewriteBaselineStore() {
  const data = {};
  return createStore(
    () => ({ ...data }),
    (next) => {
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, next);
    },
  );
}

export function createFileRewriteBaselineStore({
  path,
  exists = existsSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  rename = renameSync,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
  staleLockMs = DEFAULT_STALE_LOCK_MS,
} = {}) {
  const filePath = path || rewriteBaselineStorePath();
  const lockPath = `${filePath}.lock`;
  const lockOptions = { lockWaitMs, staleLockMs };
  const store = {
    read(scope) {
      const value = readAll()[rewriteBaselineScopeKey(scope)];
      if (value == null) return null;
      return exactSha(value, "original_local_tip_baseline");
    },
    create(scope, originalLocalTip) {
      return withStoreLock(lockPath, lockOptions, (lease) => {
        const data = readAll();
        const key = rewriteBaselineScopeKey(scope);
        if (data[key]) throw new Error("rewrite_baseline_already_exists");
        data[key] = exactSha(originalLocalTip, "original_local_tip");
        writeAll(data, lease);
        return data[key];
      });
    },
    consume(scope) {
      return withStoreLock(lockPath, lockOptions, (lease) => {
        const data = readAll();
        const key = rewriteBaselineScopeKey(scope);
        const value = data[key];
        if (value == null) return null;
        const sha = exactSha(value, "original_local_tip_baseline");
        delete data[key];
        writeAll(data, lease);
        return sha;
      });
    },
  };
  function readAll() {
    if (!exists(filePath)) return {};
    let parsed;
    try {
      parsed = JSON.parse(readFile(filePath, "utf8"));
    } catch {
      throw new Error("rewrite_baseline_store_unreadable");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("rewrite_baseline_store_unreadable");
    }
    return parsed;
  }
  function writeAll(next, lease) {
    assertOwnsLock(lockPath, lease);
    mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
    writeFile(tempPath, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
    assertOwnsLock(lockPath, lease);
    rename(tempPath, filePath);
  }
  return store;
}
