import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

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

function inspectLock(lockPath) {
  const stat = statSync(lockPath);
  return {
    stat,
    lease: readLease(lockPath),
  };
}

function reclaimStaleLock(lockPath, staleLockMs) {
  const first = inspectLock(lockPath);
  if (Date.now() - first.stat.mtimeMs < staleLockMs) return null;

  if (first.lease) {
    const current = readLease(lockPath);
    if (
      current &&
      current.generation === first.lease.generation &&
      current.token === first.lease.token
    ) {
      rmSync(lockPath, { force: true });
      return first.lease.generation + 1;
    }
    return null;
  }

  const second = inspectLock(lockPath);
  if (second.lease) return null;
  if (second.stat.mtimeMs !== first.stat.mtimeMs || second.stat.size !== first.stat.size) {
    return null;
  }
  rmSync(lockPath, { force: true });
  return 1;
}

function storePathFromLock(lockPath) {
  return lockPath.endsWith(".lock") ? lockPath.slice(0, -".lock".length) : lockPath;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listGenerationFiles(filePath) {
  const dir = dirname(filePath);
  const base = basename(filePath);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const matchName = new RegExp(`^${escapeRegExp(base)}\\.(\\d+)$`);
  const found = [];
  for (const name of names) {
    const match = name.match(matchName);
    if (!match) continue;
    found.push({ generation: Number(match[1]), path: join(dir, name) });
  }
  found.sort((a, b) => a.generation - b.generation);
  return found;
}

function highestPublishedGeneration(filePath) {
  return listGenerationFiles(filePath).at(-1)?.generation ?? 0;
}

function parseStorePayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("rewrite_baseline_store_unreadable");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("rewrite_baseline_store_unreadable");
  }
  return parsed;
}

function acquireLock(lockPath, { lockWaitMs, staleLockMs, filePath }) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const started = Date.now();
  let nextGeneration = 1;
  while (true) {
    nextGeneration = Math.max(
      nextGeneration,
      highestPublishedGeneration(filePath || storePathFromLock(lockPath)) + 1,
    );
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
      const reclaimed = reclaimStaleLock(lockPath, staleLockMs);
      if (reclaimed != null) {
        nextGeneration = Math.max(
          reclaimed,
          highestPublishedGeneration(filePath || storePathFromLock(lockPath)) + 1,
        );
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
    filePath: options.filePath,
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
  const lockOptions = { lockWaitMs, staleLockMs, filePath };
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
    const generations = listGenerationFiles(filePath);
    for (let i = generations.length - 1; i >= 0; i--) {
      let raw;
      try {
        raw = readFile(generations[i].path, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (!String(raw).trim()) continue;
      try {
        return parseStorePayload(raw);
      } catch (error) {
        if (error?.message === "rewrite_baseline_store_unreadable") continue;
        throw error;
      }
    }
    if (!exists(filePath)) return {};
    return parseStorePayload(readFile(filePath, "utf8"));
  }
  function writeAll(next, lease) {
    assertOwnsLock(lockPath, lease);
    mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
    writeFile(tempPath, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
    assertOwnsLock(lockPath, lease);
    const destPath = `${filePath}.${lease.generation}`;
    try {
      const fd = openSync(destPath, "wx", 0o600);
      closeSync(fd);
    } catch (error) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // best-effort temp cleanup after a failed generation claim
      }
      if (error?.code === "EEXIST") {
        throw new Error(`rewrite_baseline_store_lock_lost:${lockPath}`);
      }
      throw error;
    }
    rename(tempPath, destPath);
    for (const older of listGenerationFiles(filePath)) {
      if (older.generation >= lease.generation) continue;
      try {
        rmSync(older.path, { force: true });
      } catch {
        // best-effort cleanup of superseded generations
      }
    }
    if (exists(filePath)) {
      try {
        rmSync(filePath, { force: true });
      } catch {
        // best-effort cleanup of the unversioned compatibility file
      }
    }
  }
  return store;
}
