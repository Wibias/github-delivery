import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const SKILL_INSTALL_LOCK_NAME = ".github-delivery-install.lock";
export const AUTHORITY_INSTALL_LOCK_NAME = ".github-delivery-authority-install.lock";

const OWNED_LOCK_TOKEN_RE = /^([1-9]\d*)-[0-9a-f]{32}$/i;

export function targetInstallLockPath(target) {
  return join(dirname(resolve(target)), SKILL_INSTALL_LOCK_NAME);
}

export function authorityInstallLockPath(root) {
  return join(resolve(root), AUTHORITY_INSTALL_LOCK_NAME);
}

function createLockToken() {
  return `${process.pid}-${randomBytes(16).toString("hex")}`;
}

function defaultProcessExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

function tryCreateInstallLock(lockPath, token) {
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    try {
      writeFileSync(fd, `${token}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (error) {
    const held = error?.code === "EEXIST"
      || (process.platform === "win32" && error?.code === "EPERM");
    if (held) return false;
    throw error;
  }
}

function readLockToken(lockPath) {
  try {
    return readFileSync(lockPath, "utf8").trim();
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function ownsLock(lockPath, token) {
  return readLockToken(lockPath) === token;
}

function reclaimStaleOwnedLock(lockPath, processExists) {
  const token = readLockToken(lockPath);
  if (token === null) return true;
  const match = token.match(OWNED_LOCK_TOKEN_RE);
  if (!match) return false;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;

  let exists;
  try {
    exists = processExists(pid);
  } catch {
    return false;
  }
  if (exists !== false) return false;
  if (!ownsLock(lockPath, token)) return false;

  try {
    rmSync(lockPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
}

function acquireInstallLock(lockPath, { processExists = defaultProcessExists } = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = createLockToken();
  if (tryCreateInstallLock(lockPath, token)) return token;
  if (!reclaimStaleOwnedLock(lockPath, processExists)) throw new Error("install_lock_held");
  if (!tryCreateInstallLock(lockPath, token)) throw new Error("install_lock_held");
  return token;
}

function releaseInstallLock(lockPath, token) {
  try {
    if (!ownsLock(lockPath, token)) return;
    rmSync(lockPath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function withExclusiveInstallLock(lockPath, fn, options = {}) {
  const token = acquireInstallLock(lockPath, options);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseInstallLock(lockPath, token);
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(release);
    }
    release();
    return result;
  } catch (error) {
    release();
    throw error;
  }
}
