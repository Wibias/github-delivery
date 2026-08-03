import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyInstallation,
  planInstallation,
  restoreBackup,
} from "../../scripts/lib/distribution.mjs";

function skill(dir, version, marker = version) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "github-delivery", version }, null, 2));
  writeFileSync(join(dir, "marker.txt"), marker);
}

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
