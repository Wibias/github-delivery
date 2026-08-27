import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withExclusiveInstallLock } from "../../scripts/lib/install-lock.mjs";

function lockToken(pid, hex = "a") {
  return `${pid}-${hex.repeat(32)}\n`;
}

test("exclusive install lock reclaims a lock owned by a process that no longer exists", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-install-lock-stale-"));
  const lockPath = join(root, "install.lock");
  writeFileSync(lockPath, lockToken(424242));

  const result = withExclusiveInstallLock(
    lockPath,
    () => "ran",
    { processExists: () => false },
  );

  assert.equal(result, "ran");
  assert.equal(existsSync(lockPath), false);
});

test("exclusive install lock keeps a lock whose owner process is still alive", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-install-lock-live-"));
  const lockPath = join(root, "install.lock");
  const token = lockToken(424242, "b");
  writeFileSync(lockPath, token);

  assert.throws(
    () => withExclusiveInstallLock(lockPath, () => "must not run", { processExists: () => true }),
    /install_lock_held/,
  );
  assert.equal(readFileSync(lockPath, "utf8"), token);
});

test("exclusive install lock never reclaims an unrecognized lock token", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-install-lock-unknown-"));
  const lockPath = join(root, "install.lock");
  writeFileSync(lockPath, "foreign-holder\n");

  assert.throws(
    () => withExclusiveInstallLock(lockPath, () => "must not run", { processExists: () => false }),
    /install_lock_held/,
  );
  assert.equal(readFileSync(lockPath, "utf8"), "foreign-holder\n");
});
