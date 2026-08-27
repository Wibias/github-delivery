import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";

import {
  listInstallationBackups,
  removeOldInstallationBackups,
} from "./installation-backups.mjs";
import {
  inspectWindowsInstallLocks,
  requestGracefulProcessClose,
} from "./windows-install-locks.mjs";

const INSTALL_RETRY_ATTEMPTS = 3;
const LOCK_POLL_ATTEMPTS = 20;
const RETRY_DELAY_MS = 250;
const LOCK_POLL_DELAY_MS = 500;

function sleepDefault(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function askYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  try {
    const answer = String(await rl.question(question) || "").trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } catch {
    return false;
  } finally {
    rl.close();
  }
}

function interactive(input) {
  return input?.isTTY === true;
}

function retriableWindowsLock(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "");
  return code === "EPERM" || code === "EBUSY" || /\b(?:EPERM|EBUSY)\b/i.test(message);
}

function targetLocked(error, blockers = [], extra = {}) {
  const wrapped = new Error("install_target_locked");
  wrapped.code = "install_target_locked";
  wrapped.blockers = blockers;
  wrapped.cause = error;
  Object.assign(wrapped, extra);
  return wrapped;
}

function blockerSummary(blockers) {
  return blockers.map((blocker) => {
    const paths = blocker.paths?.length
      ? `\n${blocker.paths.map((path) => `      ${path}`).join("\n")}`
      : "";
    return `  - ${blocker.name} (PID ${blocker.pid})${paths}`;
  }).join("\n");
}

async function defaultConfirmClose({ blockers, input, output }) {
  output?.write?.(`\nGitHub Delivery cannot update because these processes are using the installed skill:\n${blockerSummary(blockers)}\n`);
  return askYesNo("Close the listed application(s) gracefully and continue the update? [y/N] ", { input, output });
}

async function defaultConfirmBackupCleanup({ oldBackups, keepBackup, input, output }) {
  output?.write?.(`\nOlder GitHub Delivery backups were found:\n${oldBackups.map((path) => `  - ${path}`).join("\n")}\n`);
  output?.write?.(`The fresh rollback backup from this update will be kept:\n  - ${keepBackup}\n`);
  return askYesNo("Remove the older backups? [y/N] ", { input, output });
}

function safeInspect(inspect, target, dependencies, originalError) {
  try {
    return {
      blockers: inspect(target, {
        platform: dependencies.platform ?? process.platform,
        ...(dependencies.lockProbeSpawn ? { spawn: dependencies.lockProbeSpawn } : {}),
      }),
      probeError: null,
    };
  } catch (error) {
    return {
      blockers: [],
      probeError: String(error?.detail || error?.message || error || originalError),
    };
  }
}

export async function installWithWindowsLockRecovery({
  install,
  installOptions,
  target,
  dependencies = {},
} = {}) {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "win32") return install(installOptions);

  const sleep = dependencies.sleep || sleepDefault;
  const inspect = dependencies.inspectWindowsInstallLocks || inspectWindowsInstallLocks;
  const closeProcess = dependencies.requestGracefulProcessClose || requestGracefulProcessClose;
  const input = dependencies.input || process.stdin;
  const output = dependencies.output || process.stdout;
  const confirmClose = dependencies.confirmCloseLockingProcesses || defaultConfirmClose;

  let lastError = null;
  for (let attempt = 1; attempt <= INSTALL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return install(installOptions);
    } catch (error) {
      if (!retriableWindowsLock(error)) throw error;
      lastError = error;
      if (attempt < INSTALL_RETRY_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  const firstProbe = safeInspect(inspect, target, dependencies, lastError);
  const blockers = firstProbe.blockers;
  if (!interactive(input) || blockers.length === 0) {
    throw targetLocked(lastError, blockers, firstProbe.probeError ? { probeError: firstProbe.probeError } : {});
  }

  const approved = await confirmClose({ blockers, target, input, output });
  if (!approved) throw targetLocked(lastError, blockers);

  const closeResults = [];
  for (const blocker of blockers) {
    if (Number(blocker.pid) === process.pid) {
      closeResults.push({ requested: false, pid: blocker.pid, reason: "current_process" });
      continue;
    }
    try {
      closeResults.push(closeProcess(blocker, {
        platform,
        ...(dependencies.lockProbeSpawn ? { spawn: dependencies.lockProbeSpawn } : {}),
      }));
    } catch (error) {
      closeResults.push({
        requested: false,
        pid: blocker.pid,
        reason: "close_request_failed",
        detail: String(error?.message || error),
      });
    }
  }

  let remaining = blockers;
  let probeError = null;
  for (let attempt = 0; attempt < LOCK_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(LOCK_POLL_DELAY_MS);
    const probe = safeInspect(inspect, target, dependencies, lastError);
    remaining = probe.blockers;
    probeError = probe.probeError;
    if (remaining.length === 0 && !probeError) break;
  }

  if (remaining.length > 0 || probeError) {
    throw targetLocked(lastError, remaining.length ? remaining : blockers, {
      closeResults,
      ...(probeError ? { probeError } : {}),
    });
  }

  try {
    return install(installOptions);
  } catch (error) {
    if (!retriableWindowsLock(error)) throw error;
    const finalProbe = safeInspect(inspect, target, dependencies, error);
    throw targetLocked(error, finalProbe.blockers, {
      closeResults,
      ...(finalProbe.probeError ? { probeError: finalProbe.probeError } : {}),
    });
  }
}

export async function offerBackupCleanup({
  target,
  backupRoot,
  keepBackup,
  dependencies = {},
} = {}) {
  const keep = keepBackup ? resolve(keepBackup) : null;
  const result = {
    offered: false,
    accepted: false,
    kept: keep,
    removed: [],
    failed: [],
  };
  if (!keep) return result;

  const list = dependencies.listInstallationBackups || listInstallationBackups;
  const remove = dependencies.removeOldInstallationBackups || removeOldInstallationBackups;
  const input = dependencies.input || process.stdin;
  const output = dependencies.output || process.stdout;
  const confirmCleanup = dependencies.confirmBackupCleanup || defaultConfirmBackupCleanup;

  let allBackups;
  try {
    allBackups = list({ target, backupRoot });
  } catch (error) {
    result.failed.push({
      path: resolve(backupRoot || keep),
      error: String(error?.code || error?.message || error),
    });
    return result;
  }

  const oldBackups = allBackups.map((path) => resolve(path)).filter((path) => path !== keep);
  if (oldBackups.length === 0 || !interactive(input)) return result;

  result.offered = true;
  result.accepted = await confirmCleanup({
    oldBackups,
    keepBackup: keep,
    target,
    input,
    output,
  });
  if (!result.accepted) return result;

  try {
    const cleanup = remove({
      target,
      backupRoot,
      backups: oldBackups,
      keepBackup: keep,
    }) || {};
    result.removed = Array.isArray(cleanup.removed) ? cleanup.removed : [];
    result.failed = Array.isArray(cleanup.failed) ? cleanup.failed : [];
  } catch (error) {
    result.failed = oldBackups.map((path) => ({
      path,
      error: String(error?.code || error?.message || error),
    }));
  }
  return result;
}
