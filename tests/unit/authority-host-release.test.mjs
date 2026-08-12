import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAuthorityHostRelease } from "../../scripts/build-authority-host-release.mjs";
import {
  acquireVerifiedAuthorityHostPayload,
  extractVerifiedAuthorityHostZip,
  validateAuthorityHostReleaseMetadata,
} from "../../scripts/lib/authority-host-release.mjs";

const VERSION = "0.5.2";
const SOURCE = "b".repeat(40);

function makePackage() {
  const root = mkdtempSync(join(tmpdir(), "gd-authority-verify-"));
  const publishDir = join(root, "publish");
  const outDir = join(root, "out");
  mkdirSync(publishDir, { recursive: true });
  writeFileSync(join(publishDir, "GitHubDeliveryAuthority.exe"), "exe");
  writeFileSync(join(publishDir, "GitHubDeliveryAuthority.dll"), "dll");
  const built = buildAuthorityHostRelease({ publishDir, outDir, version: VERSION, sourceCommit: SOURCE });
  return {
    root,
    built,
    archive: readFileSync(built.archivePath),
    metadataBytes: readFileSync(built.metadataPath),
  };
}

function releaseFor(built) {
  return {
    tag_name: `v${VERSION}`,
    draft: false,
    prerelease: false,
    assets: [
      { name: built.metadata.archive, browser_download_url: "https://example.test/authority.zip" },
      { name: built.metadata.archive.replace(/\.zip$/, ".json"), browser_download_url: "https://example.test/authority.json" },
    ],
  };
}

function clientFor({ built, archive, metadataBytes }) {
  return {
    async latestRelease() { return releaseFor(built); },
    async resolveTagCommit(tag) {
      assert.equal(tag, `v${VERSION}`);
      return SOURCE;
    },
    async downloadAsset(asset) {
      return asset.name.endsWith(".json") ? metadataBytes : archive;
    },
  };
}

function successfulAttestationRunner() {
  return { status: 0, stdout: "verified", stderr: "", error: null };
}

test("validates exact authority release identity and file manifest", () => {
  const fixture = makePackage();
  try {
    const validated = validateAuthorityHostReleaseMetadata(fixture.built.metadata, {
      version: VERSION,
      sourceCommit: SOURCE,
    });
    assert.equal(validated.version, VERSION);
    assert.equal(validated.sourceCommit, SOURCE);
    assert(validated.files.some((entry) => entry.path === "GitHubDeliveryAuthority.exe"));
    assert(validated.files.some((entry) => entry.path === "authority-host-version.json"));

    assert.throws(
      () => validateAuthorityHostReleaseMetadata({ ...fixture.built.metadata, platform: "linux" }, { version: VERSION, sourceCommit: SOURCE }),
      /authority_host_release_metadata_invalid/,
    );
    assert.throws(
      () => validateAuthorityHostReleaseMetadata({ ...fixture.built.metadata, sourceCommit: "c".repeat(40) }, { version: VERSION, sourceCommit: SOURCE }),
      /authority_host_release_metadata_invalid/,
    );
    const duplicate = structuredClone(fixture.built.metadata);
    duplicate.files.push({ ...duplicate.files[0] });
    assert.throws(
      () => validateAuthorityHostReleaseMetadata(duplicate, { version: VERSION, sourceCommit: SOURCE }),
      /authority_host_release_metadata_duplicate_path/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("strictly extracts a verified authority archive under the fixed root", () => {
  const fixture = makePackage();
  try {
    const destination = join(fixture.root, "extract");
    const result = extractVerifiedAuthorityHostZip({
      archive: fixture.archive,
      metadata: fixture.built.metadata,
      destination,
    });
    assert.equal(readFileSync(join(result.root, "GitHubDeliveryAuthority.exe"), "utf8"), "exe");
    const versionInfo = JSON.parse(readFileSync(join(result.root, "authority-host-version.json"), "utf8"));
    assert.equal(versionInfo.version, VERSION);
    assert.equal(versionInfo.sourceCommit, SOURCE);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("acquires only a digest- and attestation-verified authority payload", async () => {
  const fixture = makePackage();
  try {
    const client = clientFor(fixture);
    const payload = await acquireVerifiedAuthorityHostPayload({
      release: releaseFor(fixture.built),
      workspace: join(fixture.root, "workspace"),
      client,
      expectedVersion: VERSION,
      expectedSourceCommit: SOURCE,
      attestationRunner: successfulAttestationRunner,
    });
    assert.equal(payload.verified, true);
    assert.equal(payload.metadata.version, VERSION);
    assert.equal(readFileSync(join(payload.source, "GitHubDeliveryAuthority.exe"), "utf8"), "exe");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects archive tampering before extraction", async () => {
  const fixture = makePackage();
  try {
    const tampered = Buffer.from(fixture.archive);
    tampered[tampered.length - 1] ^= 0x01;
    await assert.rejects(
      acquireVerifiedAuthorityHostPayload({
        release: releaseFor(fixture.built),
        workspace: join(fixture.root, "workspace"),
        client: clientFor({ ...fixture, archive: tampered }),
        expectedVersion: VERSION,
        expectedSourceCommit: SOURCE,
        attestationRunner: successfulAttestationRunner,
      }),
      /authority_host_release_archive_digest_mismatch/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects authority payloads whose GitHub attestation does not verify", async () => {
  const fixture = makePackage();
  try {
    await assert.rejects(
      acquireVerifiedAuthorityHostPayload({
        release: releaseFor(fixture.built),
        workspace: join(fixture.root, "workspace"),
        client: clientFor(fixture),
        expectedVersion: VERSION,
        expectedSourceCommit: SOURCE,
        attestationRunner: () => ({ status: 1, stdout: "", stderr: "no attestation", error: null }),
      }),
      /stable_release_attestation_failed/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
