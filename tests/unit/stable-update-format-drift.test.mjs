import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareVerifiedReleaseCandidate } from "../../scripts/lib/release-self-update.mjs";
import { planStableUpdate, sha256 } from "../../scripts/lib/stable-release-update.mjs";

function requiredAssets(version) {
  return [
    { name: `github-delivery-v${version}.zip` },
    { name: "manifest.json" },
    { name: "SHA256SUMS" },
  ];
}

function manifest(version, files) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version,
    sourceCommit: "a".repeat(40),
    files,
  };
}

function file(path, content) {
  return {
    path,
    mode: "0644",
    bytes: Buffer.byteLength(content),
    sha256: sha256(Buffer.from(content)),
  };
}

function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "gd-format-drift-"));
  const installed = join(root, "installed");
  const release = join(root, "release");
  mkdirSync(installed, { recursive: true });
  mkdirSync(release, { recursive: true });
  try {
    return callback({ root, installed, release });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("newer verified release treats BOM/CRLF-only drift as target-converged", () => withFixture(({ installed, release }) => {
  const fixtures = [
    ["README.md", "# GitHub Delivery\n\nStable text.\n"],
    ["authority-host/windows/install.ps1", "Write-Host 'stable'\n"],
  ];

  for (const [path, content] of fixtures) {
    mkdirSync(join(installed, ...path.split("/").slice(0, -1)), { recursive: true });
    mkdirSync(join(release, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(release, ...path.split("/")), content);
    writeFileSync(
      join(installed, ...path.split("/")),
      `\uFEFF${content.replace(/\n/g, "\r\n")}`,
    );
  }

  const installedManifest = manifest("1.7.1", fixtures.map(([path, content]) => file(path, content)));
  const targetManifest = manifest("1.8.0", fixtures.map(([path, content]) => file(path, content)));
  const plan = planStableUpdate({
    releases: [{
      tag_name: "v1.8.0",
      draft: false,
      prerelease: false,
      assets: requiredAssets("1.8.0"),
    }],
    target: installed,
    installedManifest,
    targetManifest,
    targetSource: release,
    dependencies: { enforcePosixMode: false },
  });

  assert.equal(plan.action, "update");
  assert.equal(plan.safeToReplace, true);
  assert.deepEqual(plan.blockingLocalModifications, []);
  assert.deepEqual(
    plan.formatOnlyTargetConvergedLocalModifications.map((entry) => entry.path),
    fixtures.map(([path]) => path),
  );
}));

test("format-drift recovery does not forgive semantic content changes", () => withFixture(({ installed, release }) => {
  const path = "README.md";
  const installedReleaseContent = "release 1.7.1\n";
  const targetContent = "release 1.8.0\n";
  writeFileSync(join(installed, path), "local edit\r\n");
  writeFileSync(join(release, path), targetContent);

  const plan = planStableUpdate({
    releases: [{
      tag_name: "v1.8.0",
      draft: false,
      prerelease: false,
      assets: requiredAssets("1.8.0"),
    }],
    target: installed,
    installedManifest: manifest("1.7.1", [file(path, installedReleaseContent)]),
    targetManifest: manifest("1.8.0", [file(path, targetContent)]),
    targetSource: release,
    dependencies: { enforcePosixMode: false },
  });

  assert.equal(plan.action, "blocked_local_modifications");
  assert.equal(plan.safeToReplace, false);
  assert.deepEqual(plan.blockingLocalModifications, [{ path, reason: "changed" }]);
  assert.deepEqual(plan.formatOnlyTargetConvergedLocalModifications, []);
}));

test("verified release candidate passes the extracted release tree into update planning", async () => {
  let planningInput = null;
  const source = "/verified/release/github-delivery";
  const payloadManifest = manifest("1.8.0", []);
  const releaseMetadata = {
    tag_name: "v1.8.0",
    draft: false,
    prerelease: false,
    assets: requiredAssets("1.8.0"),
  };

  await prepareVerifiedReleaseCandidate({
    target: "/installed/github-delivery",
    workspace: "/workspace",
    dependencies: {
      acquireVerifiedReleasePayload: async () => ({
        schemaVersion: 1,
        kind: "github-delivery/verified-release-payload",
        verified: true,
        source,
        archivePath: "/workspace/release.zip",
        manifest: payloadManifest,
        release: { tag: "v1.8.0", version: "1.8.0", sourceCommit: "a".repeat(40) },
        releaseMetadata,
      }),
      planStableUpdate(input) {
        planningInput = input;
        return { action: "update", safeToReplace: true };
      },
    },
  });

  assert.equal(planningInput.targetSource, source);
  assert.equal(planningInput.targetManifest, payloadManifest);
});
