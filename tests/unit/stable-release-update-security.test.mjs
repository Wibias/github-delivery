import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  compareInstalledManifest,
  parseChecksums,
  planStableUpdate,
  releaseAssetPlan,
} from "../../scripts/lib/stable-release-update.mjs";

function regularStats(mode = 0o100644) {
  return {
    isFile: () => true,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    mode,
  };
}

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
    lstat: () => regularStats(0o100644),
    readFile: () => Buffer.from("tracked"),
    sha256: () => "b".repeat(64),
    listFiles: () => [],
  };
}

function dirtyInstalledDependencies() {
  return {
    lstat: () => regularStats(0o100644),
    readFile: () => Buffer.from("locally changed"),
    sha256: () => "c".repeat(64),
    listFiles: () => ["SKILL.md"],
  };
}

function legacySkill(version) {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-legacy-update-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "github-delivery", version }, null, 2));
  writeFileSync(join(root, "SKILL.md"), "---\nname: github-delivery\ndescription: legacy fixture\n---\n");
  writeFileSync(join(root, "scripts", "install-skill.mjs"), "// legacy installer\n");
  return root;
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

test("current and ahead releases remain no-ops when local drift exists", () => {
  for (const [releaseVersion, installedVersion, expectedAction] of [
    ["0.4.0", "0.4.0", "already_current"],
    ["0.3.0", "0.4.0", "already_ahead"],
  ]) {
    const plan = planStableUpdate({
      releases: [{
        tag_name: `v${releaseVersion}`,
        draft: false,
        prerelease: false,
        assets: requiredAssets(releaseVersion),
      }],
      target: "/skill",
      installedManifest: manifest(installedVersion, [{
        path: "SKILL.md",
        mode: "0644",
        sha256: "b".repeat(64),
      }]),
      dependencies: dirtyInstalledDependencies(),
    });

    assert.equal(plan.action, expectedAction);
    assert.equal(plan.safeToReplace, false);
    assert.deepEqual(plan.localModifications, [{ path: "SKILL.md", reason: "changed" }]);
  }
});

test("recognized manifestless installations get a migration plan without synthetic integrity", () => {
  for (const installedVersion of ["0.4.0", "0.5.0"]) {
    const target = legacySkill(installedVersion);
    const plan = planStableUpdate({
      releases: [{
        tag_name: "v0.5.0",
        draft: false,
        prerelease: false,
        assets: requiredAssets("0.5.0"),
      }],
      target,
    });

    assert.equal(plan.action, "migrate_legacy");
    assert.equal(plan.currentVersion, installedVersion);
    assert.equal(plan.legacyManifestless, true);
    assert.equal(plan.integrityKnown, false);
    assert.equal(plan.migrationAllowed, true);
    assert.equal(plan.safeToReplace, false);
    assert.equal(plan.localModifications, null);
  }
});

test("legacy migration never downgrades a manifestless installation", () => {
  const target = legacySkill("0.6.0");
  const plan = planStableUpdate({
    releases: [{
      tag_name: "v0.5.0",
      draft: false,
      prerelease: false,
      assets: requiredAssets("0.5.0"),
    }],
    target,
  });

  assert.equal(plan.action, "already_ahead");
  assert.equal(plan.legacyManifestless, true);
  assert.equal(plan.integrityKnown, false);
  assert.equal(plan.migrationAllowed, false);
  assert.equal(plan.safeToReplace, false);
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

test("installed manifest comparison rejects symlink and directory substitutions", () => {
  const tracked = { path: "SKILL.md", mode: "0644", sha256: "b".repeat(64) };
  const matchingContent = {
    exists: () => true,
    readFile: () => Buffer.from("tracked"),
    sha256: () => "b".repeat(64),
    listFiles: () => [],
  };

  const symlink = compareInstalledManifest({
    manifest: manifest("0.4.0", [tracked]),
    target: "/skill",
    dependencies: {
      ...matchingContent,
      lstat: () => ({
        isFile: () => false,
        isSymbolicLink: () => true,
        isDirectory: () => false,
        mode: 0o120777,
      }),
    },
  });
  assert.equal(symlink.clean, false);
  assert.deepEqual(symlink.modifications, [{ path: "SKILL.md", reason: "not_regular" }]);

  const directory = compareInstalledManifest({
    manifest: manifest("0.4.0", [tracked]),
    target: "/skill",
    dependencies: {
      ...matchingContent,
      lstat: () => ({
        isFile: () => false,
        isSymbolicLink: () => false,
        isDirectory: () => true,
        mode: 0o40755,
      }),
    },
  });
  assert.equal(directory.clean, false);
  assert.deepEqual(directory.modifications, [{ path: "SKILL.md", reason: "not_regular" }]);
});

test("installed manifest comparison enforces POSIX mode even when the hash matches", () => {
  const result = compareInstalledManifest({
    manifest: manifest("0.4.0", [{ path: "scripts/install-skill.mjs", mode: "0755", sha256: "b".repeat(64) }]),
    target: "/skill",
    dependencies: {
      exists: () => true,
      lstat: () => regularStats(0o100644),
      readFile: () => Buffer.from("tracked"),
      sha256: () => "b".repeat(64),
      listFiles: () => [],
      enforcePosixMode: true,
    },
  });
  assert.equal(result.clean, false);
  assert.deepEqual(result.modifications, [{ path: "scripts/install-skill.mjs", reason: "mode" }]);
});

test("installed manifest comparison accepts a regular file with matching hash and mode", () => {
  const result = compareInstalledManifest({
    manifest: manifest("0.4.0", [{ path: "SKILL.md", mode: "0644", sha256: "b".repeat(64) }]),
    target: "/skill",
    dependencies: {
      exists: () => true,
      lstat: () => regularStats(0o100644),
      readFile: () => Buffer.from("tracked"),
      sha256: () => "b".repeat(64),
      listFiles: () => [],
      enforcePosixMode: true,
    },
  });
  assert.equal(result.clean, true);
  assert.deepEqual(result.modifications, []);
});

test("installed manifest paths cannot escape the target", () => {
  assert.throws(
    () => compareInstalledManifest({
      manifest: manifest("0.4.0", [{
        path: "../outside",
        mode: "0644",
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
