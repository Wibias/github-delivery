import assert from "node:assert/strict";
import test from "node:test";

import {
  compareInstalledManifest,
  parseChecksums,
  planStableUpdate,
  releaseAssetPlan,
} from "../../scripts/lib/stable-release-update.mjs";

function requiredAssets(version) {
  return [
    { name: `github-delivery-v${version}.zip` },
    { name: "manifest.json" },
    { name: "SHA256SUMS" },
  ];
}

function manifest(version, files = []) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version,
    sourceCommit: "a".repeat(40),
    files,
  };
}

function cleanInstalledDependencies() {
  return {
    exists: () => true,
    readFile: () => Buffer.from("tracked"),
    sha256: () => "b".repeat(64),
    listFiles: () => [],
  };
}

test("stable update never downgrades an installation ahead of the latest release", () => {
  const plan = planStableUpdate({
    releases: [{
      tag_name: "v0.3.0",
      draft: false,
      prerelease: false,
      assets: requiredAssets("0.3.0"),
    }],
    target: "/skill",
    installedManifest: manifest("0.4.0"),
    dependencies: cleanInstalledDependencies(),
  });

  assert.equal(plan.action, "already_ahead");
  assert.equal(plan.safeToReplace, true);
});

test("required release assets must occur exactly once", () => {
  const release = {
    tag_name: "v0.5.0",
    draft: false,
    prerelease: false,
    assets: requiredAssets("0.5.0"),
  };
  release.assets.push({ name: "github-delivery-v0.5.0.zip" });

  assert.throws(
    () => releaseAssetPlan(release),
    /stable_release_asset_duplicate:github-delivery-v0\.5\.0\.zip/,
  );
});

test("installed manifest paths cannot escape the target", () => {
  assert.throws(
    () => compareInstalledManifest({
      manifest: manifest("0.4.0", [{
        path: "../outside",
        sha256: "b".repeat(64),
      }]),
      target: "/skill",
      dependencies: cleanInstalledDependencies(),
    }),
    /installed_manifest_path_invalid/,
  );
});

test("checksum parser rejects duplicate names", () => {
  const first = `${"a".repeat(64)}  manifest.json`;
  const second = `${"b".repeat(64)}  manifest.json`;
  assert.throws(
    () => parseChecksums(`${first}\n${second}\n`),
    /stable_release_checksums_duplicate:manifest\.json/,
  );
});
