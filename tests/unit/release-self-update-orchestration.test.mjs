import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { prepareVerifiedReleaseCandidate } from "../../scripts/lib/release-self-update.mjs";

const SOURCE_COMMIT = "a".repeat(40);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(version = "0.5.0") {
  const archiveName = `github-delivery-v${version}.zip`;
  const archive = Buffer.from("verified archive bytes");
  const manifest = {
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version,
    sourceCommit: SOURCE_COMMIT,
    files: [
      { path: "package.json", bytes: 48, mode: "0644", sha256: "b".repeat(64) },
      { path: "scripts/install-skill.mjs", bytes: 64, mode: "0755", sha256: "c".repeat(64) },
    ],
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = Buffer.from(
    `${sha256(archive)}  ${archiveName}\n${sha256(manifestBytes)}  manifest.json\n`,
  );
  const assets = [
    { name: archiveName, browser_download_url: `https://objects.example/${archiveName}` },
    { name: "manifest.json", browser_download_url: "https://objects.example/manifest.json" },
    { name: "SHA256SUMS", browser_download_url: "https://objects.example/SHA256SUMS" },
  ];
  const release = { tag_name: `v${version}`, draft: false, prerelease: false, assets };
  return { version, archiveName, archive, manifest, manifestBytes, checksums, assets, release };
}

function fakeClient(value, events, { resolvedCommit = SOURCE_COMMIT } = {}) {
  const byName = new Map([
    [value.archiveName, value.archive],
    ["manifest.json", value.manifestBytes],
    ["SHA256SUMS", value.checksums],
  ]);
  return {
    async latestRelease() {
      events.push("latest");
      return value.release;
    },
    async downloadAsset(asset, limit) {
      events.push(`download:${asset.name}:${limit}`);
      return byName.get(asset.name);
    },
    async resolveTagCommit(tag) {
      events.push(`tag:${tag}`);
      return resolvedCommit;
    },
  };
}

function withWorkspace(callback) {
  const workspace = mkdtempSync(join(tmpdir(), "gd-self-update-orchestration-"));
  return Promise.resolve(callback(workspace)).finally(() => rmSync(workspace, { recursive: true, force: true }));
}

test("prepares a fully verified release candidate before update planning", async () => withWorkspace(async (workspace) => {
  const value = fixture();
  const events = [];
  const source = join(workspace, "extracted", "github-delivery");
  const result = await prepareVerifiedReleaseCandidate({
    target: join(workspace, "installed"),
    workspace,
    client: fakeClient(value, events),
    attestationRunner(program, args) {
      events.push(`attest:${program}:${args.join(" ")}`);
      return { status: 0, stdout: "", stderr: "" };
    },
    dependencies: {
      extractVerifiedReleaseZip(options) {
        events.push("extract");
        assert.deepEqual(options.archive, value.archive);
        assert.deepEqual(options.manifestBytes, value.manifestBytes);
        assert.deepEqual(options.manifest, value.manifest);
        return { root: source };
      },
      planStableUpdate(options) {
        events.push("plan");
        assert.equal(options.releases[0], value.release);
        assert.equal(options.target, join(workspace, "installed"));
        return {
          schemaVersion: 1,
          kind: "github-delivery/stable-update-plan",
          action: "update",
          safeToReplace: true,
          currentVersion: "0.4.0",
          release: { tag: "v0.5.0", version: "0.5.0" },
          assets: { archive: value.archiveName, manifest: "manifest.json", checksums: "SHA256SUMS" },
          target: join(workspace, "installed"),
          localModifications: [],
        };
      },
    },
  });

  assert.equal(result.verified, true);
  assert.equal(result.source, source);
  assert.equal(result.release.tag, "v0.5.0");
  assert.equal(result.release.version, "0.5.0");
  assert.equal(result.release.sourceCommit, SOURCE_COMMIT);
  assert.equal(result.plan.action, "update");
  assert.equal(events.at(-2), "extract");
  assert.equal(events.at(-1), "plan");
  assert(events.some((entry) => entry.startsWith("attest:gh:")));
}));

test("tag/source-commit mismatch fails before attestation, extraction, or planning", async () => withWorkspace(async (workspace) => {
  const value = fixture();
  const events = [];
  await assert.rejects(
    () => prepareVerifiedReleaseCandidate({
      target: join(workspace, "installed"),
      workspace,
      client: fakeClient(value, events, { resolvedCommit: "d".repeat(40) }),
      attestationRunner() {
        events.push("attest");
        return { status: 0 };
      },
      dependencies: {
        extractVerifiedReleaseZip() {
          events.push("extract");
          return { root: join(workspace, "extracted", "github-delivery") };
        },
        planStableUpdate() {
          events.push("plan");
          return {};
        },
      },
    }),
    /stable_release_source_commit_mismatch/,
  );
  assert.equal(events.includes("attest"), false);
  assert.equal(events.includes("extract"), false);
  assert.equal(events.includes("plan"), false);
}));

test("attestation failure fails before extraction or update planning", async () => withWorkspace(async (workspace) => {
  const value = fixture();
  const events = [];
  await assert.rejects(
    () => prepareVerifiedReleaseCandidate({
      target: join(workspace, "installed"),
      workspace,
      client: fakeClient(value, events),
      attestationRunner() {
        events.push("attest");
        return { status: 1, stdout: "", stderr: "no attestation" };
      },
      dependencies: {
        extractVerifiedReleaseZip() {
          events.push("extract");
          return { root: join(workspace, "extracted", "github-delivery") };
        },
        planStableUpdate() {
          events.push("plan");
          return {};
        },
      },
    }),
    /stable_release_attestation_failed/,
  );
  assert.equal(events.includes("extract"), false);
  assert.equal(events.includes("plan"), false);
}));

test("checksum failure fails before tag resolution, attestation, extraction, or planning", async () => withWorkspace(async (workspace) => {
  const value = fixture();
  value.checksums = Buffer.from(`${"0".repeat(64)}  ${value.archiveName}\n${sha256(value.manifestBytes)}  manifest.json\n`);
  const events = [];
  await assert.rejects(
    () => prepareVerifiedReleaseCandidate({
      target: join(workspace, "installed"),
      workspace,
      client: fakeClient(value, events),
      attestationRunner() {
        events.push("attest");
        return { status: 0 };
      },
      dependencies: {
        extractVerifiedReleaseZip() {
          events.push("extract");
          return { root: join(workspace, "extracted", "github-delivery") };
        },
        planStableUpdate() {
          events.push("plan");
          return {};
        },
      },
    }),
    /stable_release_checksum_mismatch/,
  );
  assert.equal(events.some((entry) => entry.startsWith("tag:")), false);
  assert.equal(events.includes("attest"), false);
  assert.equal(events.includes("extract"), false);
  assert.equal(events.includes("plan"), false);
}));
