import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { withExclusiveInstallLock } from "../../scripts/lib/install-lock.mjs";

test("exclusive install lock reclaims a lock owned by a process that no longer exists", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-install-lock-stale-"));
  const lockPath = join(root, "install.lock");
  writeFileSync(lockPath, "424242-dead-owner\n");

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
  const token = "424242-live-owner\n";
  writeFileSync(lockPath, token);

  assert.throws(
    () => withExclusiveInstallLock(lockPath, () => "must not run", { processExists: () => true }),
    /install_lock_held/,
  );
  assert.equal(readFileSync(lockPath, "utf8"), token);
});
