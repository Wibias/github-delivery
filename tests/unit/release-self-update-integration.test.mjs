import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runInstallCommand } from "../../scripts/install-skill.mjs";

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "gd-release-update-integration-"));
  const target = join(root, "target");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "marker.txt"), "old\n");
  return Promise.resolve(callback({ root, target })).finally(() => {
    rmSync(root, { recursive: true, force: true });
  });
}

function verifiedCandidate(root, target) {
  return {
    verified: true,
    source: join(root, "verified-source"),
    manifest: {
      schemaVersion: 1,
      kind: "github-delivery/distribution-manifest",
      name: "github-delivery",
      version: "0.5.0",
      sourceCommit: "a".repeat(40),
      files: [],
    },
    release: {
      tag: "v0.5.0",
      version: "0.5.0",
      sourceCommit: "a".repeat(40),
    },
    plan: {
      schemaVersion: 1,
      kind: "github-delivery/stable-update-plan",
      action: "update",
      safeToReplace: true,
      currentVersion: "0.4.0",
      target,
      localModifications: [],
      release: { tag: "v0.5.0", version: "0.5.0" },
    },
  };
}

function workspaceDependencies(root) {
  return {
    makeWorkspace: () => join(root, "workspace"),
    removeWorkspace: () => {},
  };
}

test("release self-update dry-run never mutates the installed target", async () => withFixture(async ({ root, target }) => {
  let installCalls = 0;
  let removedWorkspace = null;
  const result = await runInstallCommand({
    update: true,
    apply: false,
    target,
  }, {
    makeWorkspace: () => join(root, "workspace"),
    removeWorkspace: (workspace) => { removedWorkspace = workspace; },
    prepareVerifiedReleaseCandidate: async ({ target: candidateTarget, workspace }) => {
      assert.equal(candidateTarget, target);
      assert.equal(workspace, join(root, "workspace"));
      return verifiedCandidate(root, target);
    },
    installSkill: () => {
      installCalls += 1;
      throw new Error("dry-run must not install");
    },
    readUserConfig: () => ({ path: join(root, "config.json"), source: "default", config: { schemaVersion: 1, authorityMode: "off" } }),
    verifyInstalledRelease: () => {
      throw new Error("dry-run must not verify a post-install state");
    },
  });

  assert.equal(installCalls, 0);
  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "old\n");
  assert.equal(result.action, "update");
  assert.equal(result.apply, false);
  assert.equal(result.updated, false);
  assert.equal(result.release.sourceCommit, "a".repeat(40));
  assert.equal(removedWorkspace, join(root, "workspace"));
}));

test("already-current and already-ahead releases are no-ops even with apply", async () => {
  for (const action of ["already_current", "already_ahead"]) {
    await withFixture(async ({ root, target }) => {
      const candidate = verifiedCandidate(root, target);
      candidate.plan.action = action;
      candidate.plan.safeToReplace = false;
      let installCalls = 0;
      const result = await runInstallCommand({ update: true, apply: true, target }, {
        ...workspaceDependencies(root),
        prepareVerifiedReleaseCandidate: async () => candidate,
        installSkill: () => { installCalls += 1; },
        readUserConfig: () => { throw new Error("no-op must not read config"); },
        verifyInstalledRelease: () => { throw new Error("no-op must not verify post-install state"); },
      });
      assert.equal(installCalls, 0);
      assert.equal(result.action, action);
      assert.equal(result.apply, true);
      assert.equal(result.updated, false);
      assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "old\n");
    });
  }
});

test("local modifications block replacement and force cannot bypass the update plan", async () => withFixture(async ({ root, target }) => {
  const candidate = verifiedCandidate(root, target);
  candidate.plan.action = "blocked_local_modifications";
  candidate.plan.safeToReplace = false;
  candidate.plan.localModifications = [{ path: "SKILL.md", reason: "changed" }];
  let installCalls = 0;

  await assert.rejects(
    runInstallCommand({ update: true, apply: true, target, force: true }, {
      ...workspaceDependencies(root),
      prepareVerifiedReleaseCandidate: async () => candidate,
      installSkill: () => { installCalls += 1; },
    }),
    /stable_release_update_blocked:blocked_local_modifications/,
  );
  assert.equal(installCalls, 0);
  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "old\n");
}));

test("candidate verification failure occurs before any installer mutation", async () => withFixture(async ({ root, target }) => {
  let installCalls = 0;
  await assert.rejects(
    runInstallCommand({ update: true, apply: true, target }, {
      ...workspaceDependencies(root),
      prepareVerifiedReleaseCandidate: async () => { throw new Error("stable_release_attestation_failed"); },
      installSkill: () => { installCalls += 1; },
    }),
    /stable_release_attestation_failed/,
  );
  assert.equal(installCalls, 0);
  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "old\n");
}));

test("release self-update apply installs only the verified candidate then verifies postconditions", async () => withFixture(async ({ root, target }) => {
  const candidate = verifiedCandidate(root, target);
  const backupPath = join(root, "backup-0.4.0");
  const configSnapshot = {
    path: join(root, "config.json"),
    source: "file",
    config: { schemaVersion: 1, authorityMode: "high-assurance" },
  };
  let configReads = 0;
  let verifyCalls = 0;
  let removedWorkspace = null;

  const result = await runInstallCommand({
    update: true,
    apply: true,
    target,
    force: true,
    allowDowngrade: false,
  }, {
    makeWorkspace: () => join(root, "workspace"),
    removeWorkspace: (workspace) => { removedWorkspace = workspace; },
    prepareVerifiedReleaseCandidate: async () => candidate,
    readUserConfig: () => {
      configReads += 1;
      return structuredClone(configSnapshot);
    },
    installSkill: (installOptions) => {
      assert.equal(installOptions.source, candidate.source);
      assert.equal(installOptions.target, target);
      assert.equal(installOptions.update, false);
      assert.equal(installOptions.apply, true);
      assert.equal(installOptions.allowDowngrade, false);
      assert.equal(installOptions.force, false);
      writeFileSync(join(target, "marker.txt"), "new\n");
      return {
        action: "upgrade",
        sourceVersion: "0.5.0",
        targetVersion: "0.4.0",
        target,
        backupPath,
        watchdog: { hookTrustRequired: true },
      };
    },
    verifyInstalledRelease: ({ target: verifyTarget, manifest }) => {
      verifyCalls += 1;
      assert.equal(verifyTarget, target);
      assert.deepEqual(manifest, candidate.manifest);
      return { clean: true };
    },
  });

  assert.equal(readFileSync(join(target, "marker.txt"), "utf8"), "new\n");
  assert.equal(configReads, 2);
  assert.equal(verifyCalls, 1);
  assert.equal(result.action, "update");
  assert.equal(result.apply, true);
  assert.equal(result.updated, true);
  assert.equal(result.previousVersion, "0.4.0");
  assert.equal(result.sourceVersion, "0.5.0");
  assert.equal(result.backupPath, backupPath);
  assert.equal(result.release.sourceCommit, "a".repeat(40));
  assert.equal(result.watchdog.hookTrustRequired, true);
  assert.equal(removedWorkspace, join(root, "workspace"));
}));

test("post-install verification failure surfaces the rollback backup path", async () => withFixture(async ({ root, target }) => {
  const candidate = verifiedCandidate(root, target);
  const backupPath = join(root, "backup-0.4.0");

  await assert.rejects(
    runInstallCommand({ update: true, apply: true, target }, {
      ...workspaceDependencies(root),
      prepareVerifiedReleaseCandidate: async () => candidate,
      readUserConfig: () => ({ config: { schemaVersion: 1, authorityMode: "off" } }),
      installSkill: () => ({ backupPath, watchdog: { hookTrustRequired: true } }),
      verifyInstalledRelease: () => { throw new Error("stable_release_postinstall_verification_failed"); },
    }),
    (error) => {
      assert.match(error.message, /stable_release_postinstall_verification_failed/);
      assert.equal(error.backupPath, backupPath);
      return true;
    },
  );
}));

test("unexpected user-config change fails closed and surfaces the rollback backup path", async () => withFixture(async ({ root, target }) => {
  const candidate = verifiedCandidate(root, target);
  const backupPath = join(root, "backup-0.4.0");
  let reads = 0;

  await assert.rejects(
    runInstallCommand({ update: true, apply: true, target }, {
      ...workspaceDependencies(root),
      prepareVerifiedReleaseCandidate: async () => candidate,
      readUserConfig: () => ({
        config: { schemaVersion: 1, authorityMode: reads++ === 0 ? "off" : "all" },
      }),
      installSkill: () => ({ backupPath, watchdog: { hookTrustRequired: true } }),
      verifyInstalledRelease: () => ({ clean: true }),
    }),
    (error) => {
      assert.equal(error.message, "stable_update_user_config_changed_unexpectedly");
      assert.equal(error.backupPath, backupPath);
      return true;
    },
  );
}));
