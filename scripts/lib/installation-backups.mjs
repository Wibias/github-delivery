import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const BACKUP_NAME = /^github-delivery-\d+-\d+\.\d+\.\d+$/;

function backupRootFor(target, backupRoot) {
  return resolve(backupRoot || join(dirname(resolve(target)), ".github-delivery-backups"));
}

function recognizedBackupPath(path, root) {
  const candidate = resolve(path);
  return dirname(candidate) === root && BACKUP_NAME.test(basename(candidate));
}

export function listInstallationBackups({ target, backupRoot } = {}) {
  if (!target) throw new Error("installation_backup_target_required");
  const root = backupRootFor(target, backupRoot);
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !BACKUP_NAME.test(entry.name)) continue;
    const path = join(root, entry.name);
    let info;
    try {
      info = lstatSync(path);
    } catch {
      continue;
    }
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    output.push(resolve(path));
  }
  return output.sort((left, right) => left.localeCompare(right));
}

export function removeOldInstallationBackups({
  target,
  backupRoot,
  backups = [],
  keepBackup = null,
  remove = rmSync,
} = {}) {
  if (!target) throw new Error("installation_backup_target_required");
  const root = backupRootFor(target, backupRoot);
  const keep = keepBackup ? resolve(keepBackup) : null;
  const removed = [];
  const failed = [];

  for (const rawPath of [...new Set(Array.isArray(backups) ? backups : [])]) {
    const path = resolve(rawPath);
    if (path === keep) continue;
    if (!recognizedBackupPath(path, root)) {
      failed.push({ path, error: "backup_path_invalid" });
      continue;
    }
    try {
      if (!existsSync(path)) continue;
      const info = lstatSync(path);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        failed.push({ path, error: "backup_path_invalid" });
        continue;
      }
      remove(path, { recursive: true, force: false });
      removed.push(path);
    } catch (error) {
      failed.push({ path, error: String(error?.code || error?.message || error) });
    }
  }

  return { removed, failed };
}
