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
      return {
        verified: true,
        source: join(root, "verified-source"),
        manifest: { version: "0.5.0" },
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
