import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  confirmApply,
  runGuidedInstall,
} from "../../scripts/lib/bootstrap-install.mjs";

function verifiedPayload(workspace, version = "0.5.0") {
  return {
    schemaVersion: 1,
    kind: "github-delivery/verified-release-payload",
    verified: true,
    source: join(workspace, "extracted", "github-delivery"),
    manifest: {
      schemaVersion: 1,
      kind: "github-delivery/distribution-manifest",
      name: "github-delivery",
      version,
      sourceCommit: "a".repeat(40),
      files: [],
    },
    release: { tag: `v${version}`, version, sourceCommit: "a".repeat(40) },
  };
}

function dependencies(overrides = {}) {
  return {
    makeWorkspace: () => "/tmp/github-delivery-bootstrap-test",
    removeWorkspace() {},
    discoverInstallations: () => [],
    async acquireVerifiedReleasePayload({ workspace }) {
      return verifiedPayload(workspace);
    },
    installSkill(options) {
      return {
        action: options.apply ? "install" : "install",
        apply: options.apply,
        sourceVersion: "0.5.0",
        targetVersion: null,
        target: options.target,
        backupPath: null,
        watchdog: { mode: "none", hookTrustRequired: false },
      };
    },
    readUserConfig: () => ({ config: { strictAuthority: false } }),
    verifyInstalledRelease: () => ({ clean: true, modifications: [] }),
    confirmApply: async () => true,
    ...overrides,
  };
}

test("confirmApply defaults to no for blank, EOF, and anything except an explicit yes", async () => {
  for (const answer of ["", null, undefined, "n", "no", "wat"]) {
    assert.equal(await confirmApply("Apply?", { ask: async () => answer }), false);
  }
  for (const answer of ["y", "Y", "yes", "YES"]) {
    assert.equal(await confirmApply("Apply?", { ask: async () => answer }), true);
  }
});

test("guided install verifies a release and performs a dry-run before asking to apply", async () => {
  const events = [];
  const target = resolve("/tmp/skills/github-delivery");
  const result = await runGuidedInstall({
    target,
    host: "unknown",
    dependencies: dependencies({
      async acquireVerifiedReleasePayload({ workspace }) {
        events.push("acquire");
        return verifiedPayload(workspace);
      },
      installSkill(options) {
        events.push(`install:${options.apply}`);
        assert.equal(options.source, "/tmp/github-delivery-bootstrap-test/extracted/github-delivery");
        assert.equal(options.target, target);
        assert.equal(options.update, false);
        assert.equal(options.allowDowngrade, false);
        assert.equal(options.force, false);
        return { action: "install", apply: options.apply, target, backupPath: null, watchdog: null };
      },
      async confirmApply(question) {
        events.push(`confirm:${question.includes("Apply")}`);
        return true;
      },
      verifyInstalledRelease() {
        events.push("verify-installed");
        return { clean: true };
      },
    }),
  });

  assert.deepEqual(events, [
    "acquire",
    "install:false",
    "confirm:true",
    "install:true",
    "verify-installed",
  ]);
  assert.equal(result.action, "install");
  assert.equal(result.apply, true);
  assert.equal(result.verified, true);
});

test("declining the shown dry-run cleans up and never calls installer apply", async () => {
  const events = [];
  const target = resolve("/tmp/skills/github-delivery");
  const deps = dependencies({
    makeWorkspace() {
      events.push("workspace:create");
      return "/tmp/github-delivery-bootstrap-cancel";
    },
    removeWorkspace(workspace) {
      events.push(`workspace:remove:${workspace}`);
    },
    async acquireVerifiedReleasePayload({ workspace }) {
      events.push("acquire");
      return verifiedPayload(workspace);
    },
    installSkill(options) {
      events.push(`install:${options.apply}`);
      if (options.apply) throw new Error("apply must not run after cancellation");
      return { action: "install", apply: false, target, backupPath: null, watchdog: null };
    },
    async confirmApply() {
      events.push("confirm:no");
      return false;
    },
    readUserConfig() {
      throw new Error("cancelled install must not need config mutation checks");
    },
    verifyInstalledRelease() {
      throw new Error("cancelled install must not verify a non-existent install");
    },
  });

  const result = await runGuidedInstall({ target, dependencies: deps });
  assert.deepEqual(result, {
    action: "cancelled",
    apply: false,
    installed: false,
    verified: true,
    sourceVersion: "0.5.0",
    target,
  });
  assert.deepEqual(events, [
    "workspace:create",
    "acquire",
    "install:false",
    "confirm:no",
    "workspace:remove:/tmp/github-delivery-bootstrap-cancel",
  ]);
});

test("accepted install requires post-install manifest verification and unchanged user config", async () => {
  let configReads = 0;
  let verified = 0;
  const target = resolve("/tmp/skills/github-delivery");
  const result = await runGuidedInstall({
    target,
    dependencies: dependencies({
      readUserConfig() {
        configReads += 1;
        return { config: { strictAuthority: false } };
      },
      installSkill(options) {
        return {
          action: "install",
          apply: options.apply,
          target,
          backupPath: options.apply ? "/tmp/backup" : null,
          watchdog: { mode: "hooks", hookTrustRequired: true },
        };
      },
      verifyInstalledRelease(options) {
        verified += 1;
        assert.equal(options.target, target);
        assert.equal(options.manifest.version, "0.5.0");
        return { clean: true };
      },
    }),
  });

  assert.equal(configReads, 2);
  assert.equal(verified, 1);
  assert.equal(result.backupPath, "/tmp/backup");
  assert.equal(result.watchdog.hookTrustRequired, true);
});

test("post-install config drift fails closed and keeps the installer backup path on the error", async () => {
  let configReads = 0;
  const target = resolve("/tmp/skills/github-delivery");
  await assert.rejects(
    runGuidedInstall({
      target,
      dependencies: dependencies({
        readUserConfig() {
          configReads += 1;
          return { config: { strictAuthority: configReads > 1 } };
        },
        installSkill(options) {
          return {
            action: "install",
            apply: options.apply,
            target,
            backupPath: options.apply ? "/tmp/recovery-backup" : null,
            watchdog: null,
          };
        },
      }),
    }),
    (error) => {
      assert.match(error.message, /stable_install_user_config_changed_unexpectedly/);
      assert.equal(error.backupPath, "/tmp/recovery-backup");
      return true;
    },
  );
});

test("explicit install refuses to silently reinstall an already valid installation", async () => {
  const target = resolve("/tmp/skills/github-delivery");
  await assert.rejects(
    runGuidedInstall({
      target,
      dependencies: dependencies({
        discoverInstallations() {
          return [{ target, valid: true, version: "0.4.0", reason: null }];
        },
        async acquireVerifiedReleasePayload() {
          throw new Error("release acquisition must not run for existing install");
        },
      }),
    }),
    /bootstrap_install_existing/,
  );
});
