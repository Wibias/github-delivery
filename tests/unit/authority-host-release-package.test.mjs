import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAuthorityHostRelease } from "../../scripts/build-authority-host-release.mjs";

const sourceCommit = "a".repeat(40);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gd-authority-package-"));
  const publishDir = join(root, "publish");
  mkdirSync(join(publishDir, "runtimes", "win-x64", "native"), { recursive: true });
  writeFileSync(join(publishDir, "GitHubDeliveryAuthority.exe"), "exe");
  writeFileSync(join(publishDir, "GitHubDeliveryAuthority.dll"), "dll");
  writeFileSync(join(publishDir, "runtimes", "win-x64", "native", "e_sqlite3.dll"), "sqlite");
  return { root, publishDir };
}

test("packages deterministic version-bound authority host release assets", () => {
  const { root, publishDir } = fixture();
  try {
    const first = buildAuthorityHostRelease({
      publishDir,
      outDir: join(root, "first"),
      version: "0.5.2",
      sourceCommit,
    });
    const second = buildAuthorityHostRelease({
      publishDir,
      outDir: join(root, "second"),
      version: "0.5.2",
      sourceCommit,
    });

    assert.equal(first.metadata.kind, "github-delivery/authority-host-release");
    assert.equal(first.metadata.version, "0.5.2");
    assert.equal(first.metadata.sourceCommit, sourceCommit);
    assert.equal(first.metadata.platform, "win32");
    assert.equal(first.metadata.arch, "x64");
    assert.equal(first.metadata.archive, "github-delivery-authority-v0.5.2-win-x64.zip");
    assert.match(first.metadata.sha256, /^[0-9a-f]{64}$/);
    assert(first.metadata.files.some((entry) => entry.path === "GitHubDeliveryAuthority.exe"));
    assert(first.metadata.files.some((entry) => entry.path === "authority-host-version.json"));
    assert.deepEqual(readFileSync(first.archivePath), readFileSync(second.archivePath));
    assert.deepEqual(
      JSON.parse(readFileSync(first.metadataPath, "utf8")),
      first.metadata,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects invalid release identity and missing executable", () => {
  const { root, publishDir } = fixture();
  try {
    assert.throws(() => buildAuthorityHostRelease({ publishDir, outDir: join(root, "bad"), version: "dev", sourceCommit }), /authority_host_release_version_invalid/);
    assert.throws(() => buildAuthorityHostRelease({ publishDir, outDir: join(root, "bad2"), version: "0.5.2", sourceCommit: "bad" }), /authority_host_release_source_commit_invalid/);
    rmSync(join(publishDir, "GitHubDeliveryAuthority.exe"));
    assert.throws(() => buildAuthorityHostRelease({ publishDir, outDir: join(root, "bad3"), version: "0.5.2", sourceCommit }), /authority_host_release_executable_missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
