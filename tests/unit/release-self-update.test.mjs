import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createGitHubReleaseClient,
  validateReleaseManifest,
  verifyGitHubAssetDigest,
  verifyReleaseAttestation,
} from "../../scripts/lib/release-self-update.mjs";

const SOURCE_COMMIT = "a".repeat(40);
const TAG_OBJECT = "b".repeat(40);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

function stableRelease(version = "0.5.0") {
  const archive = `github-delivery-v${version}.zip`;
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      { name: archive, browser_download_url: `https://objects.example/${archive}` },
      { name: "manifest.json", browser_download_url: "https://objects.example/manifest.json" },
      { name: "SHA256SUMS", browser_download_url: "https://objects.example/SHA256SUMS" },
    ],
  };
}

function validManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version: "0.5.0",
    sourceCommit: SOURCE_COMMIT,
    files: [
      { path: "SKILL.md", bytes: 12, mode: "0644", sha256: "c".repeat(64) },
      { path: "scripts/install-skill.mjs", bytes: 42, mode: "0755", sha256: "d".repeat(64) },
    ],
    ...overrides,
  };
}

test("GitHub release client reads only a published stable latest release", async () => {
  let observed = null;
  const client = createGitHubReleaseClient({
    async fetchImpl(url, options) {
      observed = { url: String(url), options };
      return jsonResponse(stableRelease());
    },
  });
  const release = await client.latestRelease();
  assert.equal(release.tag_name, "v0.5.0");
  assert.equal(observed.url, "https://api.github.com/repos/Wibias/github-delivery/releases/latest");
  assert.equal(observed.options.redirect, "manual");
  assert.match(observed.options.headers.Accept, /application\/vnd\.github\+json/);
  assert.match(observed.options.headers["User-Agent"], /github-delivery/i);
});

test("GitHub release client rejects draft, prerelease, and malformed latest tags", async () => {
  for (const release of [
    { ...stableRelease(), draft: true },
    { ...stableRelease(), prerelease: true },
    { ...stableRelease(), tag_name: "latest" },
  ]) {
    const client = createGitHubReleaseClient({ fetchImpl: async () => jsonResponse(release) });
    await assert.rejects(() => client.latestRelease(), /stable_release_metadata_invalid/);
  }
});

test("asset downloads require HTTPS across redirects", async () => {
  let calls = 0;
  const client = createGitHubReleaseClient({
    async fetchImpl(url) {
      calls += 1;
      if (calls === 1) {
        assert.equal(String(url), "https://objects.example/file.zip");
        return new Response(null, { status: 302, headers: { location: "http://mirror.example/file.zip" } });
      }
      throw new Error("insecure redirect must not be followed");
    },
  });
  await assert.rejects(
    () => client.downloadAsset({ name: "file.zip", browser_download_url: "https://objects.example/file.zip" }, 1024),
    /stable_release_download_url_invalid/,
  );
  assert.equal(calls, 1);
});

test("asset downloads enforce response byte limits", async () => {
  const client = createGitHubReleaseClient({
    fetchImpl: async () => new Response(Buffer.alloc(65), { status: 200, headers: { "content-length": "65" } }),
  });
  await assert.rejects(
    () => client.downloadAsset({ name: "file.zip", browser_download_url: "https://objects.example/file.zip" }, 64),
    /stable_release_download_limit_exceeded/,
  );
});

test("GitHub asset digest is enforced when GitHub exposes sha256", () => {
  const content = Buffer.from("verified asset");
  const digest = sha256(content);
  assert.equal(verifyGitHubAssetDigest({ digest: `sha256:${digest}` }, content), true);
  assert.throws(
    () => verifyGitHubAssetDigest({ digest: `sha256:${"0".repeat(64)}` }, content),
    /stable_release_asset_digest_mismatch/,
  );
  assert.throws(
    () => verifyGitHubAssetDigest({ digest: "sha512:abc" }, content),
    /stable_release_asset_digest_invalid/,
  );
  assert.equal(verifyGitHubAssetDigest({}, content), true);
});

test("release manifest validation binds schema, identity, version, source and files", () => {
  const manifest = validateReleaseManifest(validManifest(), { version: "0.5.0" });
  assert.equal(manifest.version, "0.5.0");
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.deepEqual(manifest.files.map((entry) => entry.path), ["SKILL.md", "scripts/install-skill.mjs"]);
});

test("release manifest rejects case-aliased file paths", () => {
  const base = validManifest().files[0];
  assert.throws(
    () => validateReleaseManifest(validManifest({
      files: [base, { ...base, path: "skill.md", sha256: "e".repeat(64) }],
    }), { version: "0.5.0" }),
    /stable_release_manifest_path_alias/,
  );
});

test("release manifest rejects invalid top-level identity and source commit", () => {
  for (const value of [
    validManifest({ schemaVersion: 2 }),
    validManifest({ kind: "other" }),
    validManifest({ name: "other" }),
    validManifest({ version: "0.4.0" }),
    validManifest({ sourceCommit: "abc" }),
  ]) {
    assert.throws(() => validateReleaseManifest(value, { version: "0.5.0" }), /stable_release_manifest_invalid/);
  }
});

test("release manifest rejects unsafe and duplicate paths", () => {
  const base = validManifest().files[0];
  for (const path of ["../outside", "/absolute", "C:/windows", "a\\b", "a/./b", "a//b", "manifest.json"] ) {
    assert.throws(
      () => validateReleaseManifest(validManifest({ files: [{ ...base, path }] }), { version: "0.5.0" }),
      /stable_release_manifest_(?:path_)?invalid/,
    );
  }
  assert.throws(
    () => validateReleaseManifest(validManifest({ files: [base, { ...base }] }), { version: "0.5.0" }),
    /stable_release_manifest_path_duplicate/,
  );
});

test("release manifest rejects invalid hashes, sizes, and modes", () => {
  const base = validManifest().files[0];
  for (const entry of [
    { ...base, sha256: "abc" },
    { ...base, bytes: -1 },
    { ...base, bytes: 1.5 },
    { ...base, mode: "0777" },
  ]) {
    assert.throws(
      () => validateReleaseManifest(validManifest({ files: [entry] }), { version: "0.5.0" }),
      /stable_release_manifest_invalid/,
    );
  }
});

test("tag resolution accepts a lightweight tag", async () => {
  const client = createGitHubReleaseClient({
    async fetchImpl(url) {
      assert.match(String(url), /\/git\/ref\/tags\/v0\.5\.0$/);
      return jsonResponse({ object: { type: "commit", sha: SOURCE_COMMIT } });
    },
  });
  assert.equal(await client.resolveTagCommit("v0.5.0"), SOURCE_COMMIT);
});

test("tag resolution peels annotated tags to a commit", async () => {
  const calls = [];
  const client = createGitHubReleaseClient({
    async fetchImpl(url) {
      calls.push(String(url));
      if (calls.length === 1) return jsonResponse({ object: { type: "tag", sha: TAG_OBJECT } });
      return jsonResponse({ object: { type: "commit", sha: SOURCE_COMMIT } });
    },
  });
  assert.equal(await client.resolveTagCommit("v0.5.0"), SOURCE_COMMIT);
  assert.match(calls[1], new RegExp(`/git/tags/${TAG_OBJECT}$`));
});

test("tag resolution rejects cycles and non-commit terminal objects", async () => {
  const cycle = createGitHubReleaseClient({
    async fetchImpl(url) {
      if (String(url).includes("/git/ref/")) return jsonResponse({ object: { type: "tag", sha: TAG_OBJECT } });
      return jsonResponse({ object: { type: "tag", sha: TAG_OBJECT } });
    },
  });
  await assert.rejects(() => cycle.resolveTagCommit("v0.5.0"), /stable_release_tag_resolution_invalid/);

  const terminal = createGitHubReleaseClient({
    fetchImpl: async () => jsonResponse({ object: { type: "tree", sha: SOURCE_COMMIT } }),
  });
  await assert.rejects(() => terminal.resolveTagCommit("v0.5.0"), /stable_release_tag_resolution_invalid/);
});

test("attestation verification constrains repo, workflow, source ref and source digest", () => {
  let invocation = null;
  const result = verifyReleaseAttestation({
    archivePath: "/tmp/github-delivery-v0.5.0.zip",
    tag: "v0.5.0",
    sourceCommit: SOURCE_COMMIT,
    runner(program, args, options) {
      invocation = { program, args, options };
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result, true);
  assert.equal(invocation.program, "gh");
  assert.deepEqual(invocation.args, [
    "attestation", "verify", "/tmp/github-delivery-v0.5.0.zip",
    "--repo", "Wibias/github-delivery",
    "--signer-workflow", "Wibias/github-delivery/.github/workflows/release.yml",
    "--source-ref", "refs/tags/v0.5.0",
    "--source-digest", SOURCE_COMMIT,
  ]);
});

test("attestation verification fails closed on missing gh or non-zero verification", () => {
  for (const runner of [
    () => ({ status: 1, stdout: "", stderr: "no attestation" }),
    () => { throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }); },
  ]) {
    assert.throws(
      () => verifyReleaseAttestation({
        archivePath: "/tmp/github-delivery-v0.5.0.zip",
        tag: "v0.5.0",
        sourceCommit: SOURCE_COMMIT,
        runner,
      }),
      /stable_release_attestation_failed/,
    );
  }
});
