import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const SKILL_INSTALL_LOCK_NAME = ".github-delivery-install.lock";
export const AUTHORITY_INSTALL_LOCK_NAME = ".github-delivery-authority-install.lock";

export function targetInstallLockPath(target) {
  return join(dirname(resolve(target)), SKILL_INSTALL_LOCK_NAME);
}

export function authorityInstallLockPath(root) {
  return join(resolve(root), AUTHORITY_INSTALL_LOCK_NAME);
}

function createLockToken() {
  return `${process.pid}-${randomBytes(16).toString("hex")}`;
}

function acquireInstallLock(lockPath) {
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = createLockToken();
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    try {
      writeFileSync(fd, `${token}\n`);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    const held = error?.code === "EEXIST"
      || (process.platform === "win32" && error?.code === "EPERM");
    if (held) throw new Error("install_lock_held");
    throw error;
  }
  return token;
}

function ownsLock(lockPath, token) {
  try {
    return readFileSync(lockPath, "utf8").trim() === token;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function releaseInstallLock(lockPath, token) {
  try {
    if (!ownsLock(lockPath, token)) return;
    rmSync(lockPath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function withExclusiveInstallLock(lockPath, fn) {
  const token = acquireInstallLock(lockPath);
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
