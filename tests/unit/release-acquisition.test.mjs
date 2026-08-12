import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireVerifiedReleasePayload,
  prepareVerifiedReleaseCandidate,
} from "../../scripts/lib/release-self-update.mjs";

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
  return { version, archiveName, archive, manifest, manifestBytes, checksums, release };
}

function fakeClient(value, events) {
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
      return SOURCE_COMMIT;
    },
  };
}

function withWorkspace(callback) {
  const workspace = mkdtempSync(join(tmpdir(), "gd-release-acquisition-"));
  return Promise.resolve(callback(workspace)).finally(() => {
    rmSync(workspace, { recursive: true, force: true });
  });
}

test("acquires and verifies a stable release without an installed target or update planning", async () => withWorkspace(async (workspace) => {
  const value = fixture();
  const events = [];
  const source = join(workspace, "extracted", "github-delivery");
  const result = await acquireVerifiedReleasePayload({
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
      planStableUpdate() {
        throw new Error("release acquisition must not perform update planning");
      },
    },
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, "github-delivery/verified-release-payload");
  assert.equal(result.verified, true);
  assert.equal(result.source, source);
  assert.deepEqual(result.manifest, value.manifest);
  assert.deepEqual(result.release, {
    tag: "v0.5.0",
    version: "0.5.0",
    sourceCommit: SOURCE_COMMIT,
  });
  assert.equal(events.at(-1), "extract");
  assert(events.some((entry) => entry.startsWith("attest:gh:")));
}));

test("update candidate planning reuses the shared verified acquisition result", async () => withWorkspace(async (workspace) => {
  const value = fixture();
  const source = join(workspace, "verified-source");
  const target = join(workspace, "installed");
  let acquireCalls = 0;
  let planCalls = 0;

  const result = await prepareVerifiedReleaseCandidate({
    target,
    workspace,
    dependencies: {
      async acquireVerifiedReleasePayload(options) {
        acquireCalls += 1;
        assert.equal(options.workspace, workspace);
        return {
          schemaVersion: 1,
          kind: "github-delivery/verified-release-payload",
          verified: true,
          source,
          manifest: value.manifest,
          release: {
            tag: "v0.5.0",
            version: "0.5.0",
            sourceCommit: SOURCE_COMMIT,
          },
          releaseMetadata: value.release,
        };
      },
      planStableUpdate(options) {
        planCalls += 1;
        assert.equal(options.target, target);
        assert.deepEqual(options.releases, [value.release]);
        return {
          schemaVersion: 1,
          kind: "github-delivery/stable-update-plan",
          action: "update",
          safeToReplace: true,
          currentVersion: "0.4.0",
          release: { tag: "v0.5.0", version: "0.5.0" },
          target,
          localModifications: [],
        };
      },
    },
  });

  assert.equal(acquireCalls, 1);
  assert.equal(planCalls, 1);
  assert.equal(result.verified, true);
  assert.equal(result.source, source);
  assert.equal(result.plan.action, "update");
}));
