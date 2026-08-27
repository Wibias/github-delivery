import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runInstallCommand } from "../../scripts/install-skill.mjs";

function eprem() {
  const error = new Error("EPERM: operation not permitted, rename target -> backup");
  error.code = "EPERM";
  return error;
}

function candidate(root, target) {
  return {
    verified: true,
    source: join(root, "verified-source"),
    manifest: {
      schemaVersion: 1,
      kind: "github-delivery/distribution-manifest",
      name: "github-delivery",
      version: "1.2.0",
      sourceCommit: "a".repeat(40),
      files: [],
    },
    release: {
      tag: "v1.2.0",
      version: "1.2.0",
      sourceCommit: "a".repeat(40),
    },
    plan: {
      schemaVersion: 1,
      kind: "github-delivery/stable-update-plan",
      action: "update",
      safeToReplace: true,
      currentVersion: "1.1.1",
      target,
      localModifications: [],
      release: { tag: "v1.2.0", version: "1.2.0" },
    },
  };
}

function updateDependencies(root, target, extra = {}) {
  const verified = candidate(root, target);
  return {
    platform: "win32",
    input: { isTTY: true },
    output: { write() {} },
    makeWorkspace: () => join(root, "workspace"),
    removeWorkspace: () => {},
    prepareVerifiedReleaseCandidate: async () => verified,
    readInstalledAuthorityHost: () => ({
      supported: false,
      installed: false,
      legacy: false,
      version: null,
      sourceCommit: null,
    }),
    reconcileStableAuthorityHost: async () => ({
      action: "unsupported",
      changed: false,
      installed: { supported: false, installed: false, legacy: false, version: null, sourceCommit: null },
    }),
    readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "off" } }),
    verifyInstalledRelease: () => ({ clean: true }),
    sleep: async () => {},
    listInstallationBackups: () => [],
    ...extra,
  };
}

async function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "gd-windows-update-ux-"));
  const target = join(root, "skills", "github-delivery");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "marker.txt"), "old\n");
  try {
    return await callback({ root, target });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Windows update retries transient EPERM before asking the user", async () => withFixture(async ({ root, target }) => {
  let installCalls = 0;
  let inspectCalls = 0;
  const freshBackup = join(root, "backups", "github-delivery-200-1.1.1");

  const result = await runInstallCommand({ update: true, apply: true, target }, updateDependencies(root, target, {
    installSkill() {
      installCalls += 1;
      if (installCalls < 3) throw eprem();
      return { backupPath: freshBackup, watchdog: null };
    },
    inspectWindowsInstallLocks() {
      inspectCalls += 1;
      return [];
    },
  }));

  assert.equal(result.updated, true);
  assert.equal(installCalls, 3);
  assert.equal(inspectCalls, 0);
}));

test("Windows update identifies a locking app, asks to close it, and continues after graceful close", async () => withFixture(async ({ root, target }) => {
  let installCalls = 0;
  let inspectCalls = 0;
  const prompts = [];
  const closes = [];
  const blocker = {
    pid: 32616,
    name: "Cursor.exe",
    paths: [join(target, "scripts"), join(target, "references", "policy")],
  };
  const freshBackup = join(root, "backups", "github-delivery-200-1.1.1");

  const result = await runInstallCommand({ update: true, apply: true, target }, updateDependencies(root, target, {
    installSkill() {
      installCalls += 1;
      if (installCalls <= 3) throw eprem();
      return { backupPath: freshBackup, watchdog: null };
    },
    inspectWindowsInstallLocks() {
      inspectCalls += 1;
      return inspectCalls === 1 ? [blocker] : [];
    },
    async confirmCloseLockingProcesses(context) {
      prompts.push(context);
      return true;
    },
    requestGracefulProcessClose(process) {
      closes.push(process);
      return { requested: true, pid: process.pid };
    },
  }));

  assert.equal(result.updated, true);
  assert.equal(installCalls, 4);
  assert.equal(prompts.length, 1);
  assert.deepEqual(prompts[0].blockers, [blocker]);
  assert.deepEqual(closes, [blocker]);
  assert.equal(inspectCalls, 2);
}));

test("declining to close a locking app aborts safely with structured blocker details", async () => withFixture(async ({ root, target }) => {
  let installCalls = 0;
  const blocker = { pid: 32616, name: "Cursor.exe", paths: [join(target, "scripts")] };

  await assert.rejects(
    runInstallCommand({ update: true, apply: true, target }, updateDependencies(root, target, {
      installSkill() {
        installCalls += 1;
        throw eprem();
      },
      inspectWindowsInstallLocks: () => [blocker],
      confirmCloseLockingProcesses: async () => false,
      requestGracefulProcessClose() {
        throw new Error("must not close after decline");
      },
    })),
    (error) => {
      assert.equal(error.message, "install_target_locked");
      assert.deepEqual(error.blockers, [blocker]);
      return true;
    },
  );
  assert.equal(installCalls, 3);
}));

test("non-interactive Windows update reports blockers without prompting or closing processes", async () => withFixture(async ({ root, target }) => {
  const blocker = { pid: 32616, name: "Cursor.exe", paths: [join(target, "references", "policy")] };

  await assert.rejects(
    runInstallCommand({ update: true, apply: true, target }, updateDependencies(root, target, {
      input: { isTTY: false },
      installSkill() { throw eprem(); },
      inspectWindowsInstallLocks: () => [blocker],
      confirmCloseLockingProcesses() { throw new Error("non-interactive update must not prompt"); },
      requestGracefulProcessClose() { throw new Error("non-interactive update must not close apps"); },
    })),
    (error) => {
      assert.equal(error.message, "install_target_locked");
      assert.deepEqual(error.blockers, [blocker]);
      return true;
    },
  );
}));

test("successful update offers to remove older backups while preserving the fresh rollback backup", async () => withFixture(async ({ root, target }) => {
  const oldOne = join(root, "backups", "github-delivery-100-1.0.0");
  const oldTwo = join(root, "backups", "github-delivery-150-1.1.0");
  const freshBackup = join(root, "backups", "github-delivery-200-1.1.1");
  let promptContext = null;
  let cleanupContext = null;

  const result = await runInstallCommand({ update: true, apply: true, target }, updateDependencies(root, target, {
    installSkill: () => ({ backupPath: freshBackup, watchdog: null }),
    listInstallationBackups: () => [oldOne, oldTwo, freshBackup],
    async confirmBackupCleanup(context) {
      promptContext = context;
      return true;
    },
    removeOldInstallationBackups(context) {
      cleanupContext = context;
      return { removed: [oldOne, oldTwo], failed: [] };
    },
  }));

  assert.deepEqual(promptContext.oldBackups, [oldOne, oldTwo]);
  assert.equal(promptContext.keepBackup, freshBackup);
  assert.deepEqual(cleanupContext.backups, [oldOne, oldTwo]);
  assert.equal(cleanupContext.keepBackup, freshBackup);
  assert.deepEqual(result.backupCleanup, {
    offered: true,
    accepted: true,
    kept: freshBackup,
    removed: [oldOne, oldTwo],
    failed: [],
  });
}));

test("declining backup cleanup keeps all backups", async () => withFixture(async ({ root, target }) => {
  const oldBackup = join(root, "backups", "github-delivery-100-1.0.0");
  const freshBackup = join(root, "backups", "github-delivery-200-1.1.1");
  let cleanupCalls = 0;

  const result = await runInstallCommand({ update: true, apply: true, target }, updateDependencies(root, target, {
    installSkill: () => ({ backupPath: freshBackup, watchdog: null }),
    listInstallationBackups: () => [oldBackup, freshBackup],
    confirmBackupCleanup: async () => false,
    removeOldInstallationBackups() {
      cleanupCalls += 1;
      return { removed: [], failed: [] };
    },
  }));

  assert.equal(cleanupCalls, 0);
  assert.equal(result.backupCleanup.accepted, false);
  assert.deepEqual(result.backupCleanup.removed, []);
  assert.equal(result.backupCleanup.kept, freshBackup);
}));

test("backup cleanup failures do not roll back an otherwise verified update", async () => withFixture(async ({ root, target }) => {
  const oldBackup = join(root, "backups", "github-delivery-100-1.0.0");
  const freshBackup = join(root, "backups", "github-delivery-200-1.1.1");

  const result = await runInstallCommand({ update: true, apply: true, target }, updateDependencies(root, target, {
    installSkill: () => ({ backupPath: freshBackup, watchdog: null }),
    listInstallationBackups: () => [oldBackup, freshBackup],
    confirmBackupCleanup: async () => true,
    removeOldInstallationBackups: () => ({
      removed: [],
      failed: [{ path: oldBackup, error: "EPERM" }],
    }),
  }));

  assert.equal(result.updated, true);
  assert.deepEqual(result.backupCleanup.failed, [{ path: oldBackup, error: "EPERM" }]);
  assert.equal(result.backupPath, freshBackup);
}));

test("default backup cleanup removes only recognized old backups and never the fresh rollback backup", async () => withFixture(async ({ root, target }) => {
  const backups = await import("../../scripts/lib/installation-backups.mjs");
  assert.equal(typeof backups.listInstallationBackups, "function");
  assert.equal(typeof backups.removeOldInstallationBackups, "function");

  const backupRoot = join(dirname(target), ".github-delivery-backups");
  const oldBackup = join(backupRoot, "github-delivery-100-1.0.0");
  const freshBackup = join(backupRoot, "github-delivery-200-1.1.1");
  const unrelated = join(backupRoot, "do-not-delete");
  for (const path of [oldBackup, freshBackup, unrelated]) mkdirSync(path, { recursive: true });

  assert.deepEqual(backups.listInstallationBackups({ target }), [oldBackup, freshBackup]);
  const cleanup = backups.removeOldInstallationBackups({
    target,
    backups: [oldBackup],
    keepBackup: freshBackup,
  });

  assert.deepEqual(cleanup, { removed: [oldBackup], failed: [] });
  assert.equal(existsSync(oldBackup), false);
  assert.equal(existsSync(freshBackup), true);
  assert.equal(existsSync(unrelated), true);
}));

test("Windows lock probe module exists and normalizes PowerShell process output", async () => {
  const modulePath = fileURLToPath(new URL("../../scripts/lib/windows-install-locks.mjs", import.meta.url));
  assert.equal(existsSync(modulePath), true, "Windows lock probe module must exist");
  const locks = await import("../../scripts/lib/windows-install-locks.mjs");
  assert.equal(typeof locks.inspectWindowsInstallLocks, "function");

  const target = "C:\\Users\\ws\\.agents\\skills\\github-delivery";
  const result = locks.inspectWindowsInstallLocks(target, {
    platform: "win32",
    spawn(command, args) {
      assert.equal(command.toLowerCase(), "powershell.exe");
      assert(args.includes(target));
      return {
        status: 0,
        stdout: JSON.stringify([
          { pid: 32616, name: "Cursor.exe", paths: [`${target}\\scripts`, `${target}\\references\\policy`] },
        ]),
        stderr: "",
      };
    },
  });

  assert.deepEqual(result, [{
    pid: 32616,
    name: "Cursor.exe",
    paths: [`${target}\\scripts`, `${target}\\references\\policy`],
  }]);
});
