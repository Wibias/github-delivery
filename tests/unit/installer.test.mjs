import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseInstallArgs } from "../../scripts/install-skill.mjs";
import {
  applyInstallation,
  planInstallation,
  restoreBackup,
} from "../../scripts/lib/distribution.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function skill(dir, version, marker = version) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "github-delivery", version }, null, 2));
  writeFileSync(join(dir, "marker.txt"), marker);
}

test("install CLI entry point runs from a file path", () => {
  const command = join(ROOT, "scripts", "install-skill.mjs");
  const result = spawnSync(process.execPath, [command], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.apply, false);
  assert.equal(typeof plan.allowed, "boolean");
});

test("installer parses self-update from the running installed bundle root", () => {
  const root = resolve("/virtual/installed/github-delivery");
  const options = parseInstallArgs(["--update"], { installedRoot: root });
  assert.equal(options.update, true);
  assert.equal(options.apply, false);
  assert.equal(options.target, root);
  assert.equal(options.targetExplicit, false);
  assert.equal(options.sourceExplicit, false);
});

test("self-update keeps an explicit target override", () => {
  const installedRoot = resolve("/virtual/installed/github-delivery");
  const target = resolve("/virtual/custom/github-delivery");
  const options = parseInstallArgs(["--update", "--target", target], { installedRoot });
  assert.equal(options.update, true);
  assert.equal(options.target, target);
  assert.equal(options.targetExplicit, true);
});

test("self-update rejects source, restore, and downgrade escape hatches", () => {
  const context = { installedRoot: resolve("/virtual/installed/github-delivery") };
  assert.throws(
    () => parseInstallArgs(["--update", "--source", resolve("/tmp/source")], context),
    /update_source_conflict/,
  );
  assert.throws(
    () => parseInstallArgs(["--update", "--restore", resolve("/tmp/backup")], context),
    /update_restore_conflict/,
  );
  assert.throws(
    () => parseInstallArgs(["--update", "--allow-downgrade"], context),
    /update_allow_downgrade_forbidden/,
  );
});

test("plans a new install without mutating the target", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-install-test-"));
  const source = join(root, "source");
  const target = join(root, "target");
  skill(source, "0.1.0");
  const plan = planInstallation({ source, target });
  assert.equal(plan.action, "install");
  assert.equal(plan.allowed, true);
  assert.equal(existsSync(target), false);
});

test("plans upgrades and blocks downgrades unless explicitly allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-install-test-"));
  const source = join(root, "source");
  const target = join(root, "target");
  skill(source, "0.2.0");
  skill(target, "0.1.0");
  assert.equal(planInstallation({ source, target }).action, "upgrade");
  skill(source, "0.0.9");
  assert.equal(planInstallation({ source, target }).allowed, false);
  assert.equal(planInstallation({ source, target, allowDowngrade: true }).action, "downgrade");
});

test("same-version identical installs are idempotent no-ops", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-install-test-"));
  const source = join(root, "source");
  const target = join(root, "target");
  skill(source, "0.2.0", "identical");
  skill(target, "0.2.0", "identical");

  const plan = planInstallation({ source, target });
  assert.equal(plan.action, "already-installed");
  assert.equal(plan.allowed, true);

  const receipt = applyInstallation({ source, target });
  assert.equal(receipt.action, "already-installed");
  assert.equal(receipt.backupPath, null);
  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "identical");
});

test("same-version installs with different payloads fail closed even with force", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-install-test-"));
  const source = join(root, "source");
  const target = join(root, "target");
  skill(source, "0.2.0", "source");
  skill(target, "0.2.0", "target");

  const plan = planInstallation({ source, target });
  assert.equal(plan.action, "same-version");
  assert.equal(plan.allowed, false);
  assert.equal(planInstallation({ source, target, force: true }).allowed, false);
  assert.throws(() => applyInstallation({ source, target }), /installation is not allowed: same-version/);
  assert.throws(() => applyInstallation({ source, target, force: true }), /installation is not allowed: same-version/);
});

test("classifies symlink targets as conflicts", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-install-test-"));
  const source = join(root, "source");
  const linked = join(root, "linked");
  const target = join(root, "target");
  skill(source, "0.1.0");
  skill(linked, "0.0.1");
  symlinkSync(linked, target, "dir");
  const plan = planInstallation({ source, target });
  assert.equal(plan.action, "replace-symlink");
  assert.equal(plan.allowed, false);
});


test("apply creates missing target parents for a new install", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-install-test-"));
  const source = join(root, "source");
  const target = join(root, "nested", "skills", "github-delivery");
  skill(source, "0.1.0", "fresh");
  applyInstallation({ source, target });
  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "fresh");
});

test("apply creates a backup before replacing and restore reverses it", () => {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-install-test-"));
  const source = join(root, "source");
  const target = join(root, "target");
  const backups = join(root, "backups");
  skill(source, "0.2.0", "new");
  skill(target, "0.1.0", "old");

  const receipt = applyInstallation({ source, target, backupRoot: backups });
  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "new");
  assert(receipt.backupPath);
  assert.equal(readFileSync(join(receipt.backupPath, "marker.txt"), "utf8"), "old");

  restoreBackup({ backup: receipt.backupPath, target });
  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "old");
});