import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createSpdxSbom,
  validateReleaseContext,
  validateReleaseSourceComparison,
  verifyDistribution,
  releaseNotesForVersion,
} from "../../scripts/lib/release-contract.mjs";
import { verifyReleaseSource } from "../../scripts/verify-release-source.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "github-delivery-release-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "github-delivery"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "github-delivery", version: "0.1.0" }));
  const archive = Buffer.from("archive");
  writeFileSync(join(dist, "github-delivery-v0.1.0.zip"), archive);
  writeFileSync(join(dist, "github-delivery-v0.1.0.tar.gz"), Buffer.from("tar"));
  writeFileSync(join(dist, "github-delivery", "SKILL.md"), "---\nname: github-delivery\n---\n");
  writeFileSync(join(dist, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    kind: "github-delivery/distribution-manifest",
    name: "github-delivery",
    version: "0.1.0",
    sourceCommit: "a".repeat(40),
    files: [{ path: "SKILL.md", bytes: 36, mode: "0644", sha256: "deadbeef" }],
  }, null, 2) + "\n");
  const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
  writeFileSync(join(dist, "SHA256SUMS"), [
    `${digest(readFileSync(join(dist, "manifest.json")))}  manifest.json`,
    `${digest(readFileSync(join(dist, "github-delivery-v0.1.0.tar.gz")))}  github-delivery-v0.1.0.tar.gz`,
    `${digest(archive)}  github-delivery-v0.1.0.zip`,
  ].join("\n") + "\n");
  return { root, dist };
}

test("tag releases require an exact package version match", () => {
  assert.deepEqual(validateReleaseContext({ eventName: "push", ref: "refs/tags/v0.1.0", version: "0.1.0" }), {
    version: "0.1.0", tag: "v0.1.0", publish: true,
  });
  assert.throws(() => validateReleaseContext({ eventName: "push", ref: "refs/tags/v0.2.0", version: "0.1.0" }), /does not match package version/);
});

test("manual workflow runs are always dry-run", () => {
  assert.deepEqual(validateReleaseContext({ eventName: "workflow_dispatch", ref: "refs/heads/main", version: "0.1.0" }), {
    version: "0.1.0", tag: "v0.1.0", publish: false,
  });
});

test("release source must be the comparison base and an ancestor of the default branch", () => {
  const source = "a".repeat(40);
  assert.deepEqual(
    validateReleaseSourceComparison({
      sourceCommit: source,
      branch: "main",
      comparison: {
        status: "ahead",
        base_commit: { sha: source },
        merge_base_commit: { sha: source },
      },
    }),
    {
      valid: true,
      sourceCommit: source,
      branch: "main",
      status: "ahead",
      mergeBase: source,
    },
  );
});

test("release source rejects diverged and non-ancestor tag commits", () => {
  const source = "a".repeat(40);
  const other = "b".repeat(40);
  assert.throws(
    () => validateReleaseSourceComparison({
      sourceCommit: source,
      branch: "main",
      comparison: {
        status: "diverged",
        base_commit: { sha: source },
        merge_base_commit: { sha: other },
      },
    }),
    /not an ancestor/,
  );
  assert.throws(
    () => validateReleaseSourceComparison({
      sourceCommit: source,
      branch: "main",
      comparison: {
        status: "behind",
        base_commit: { sha: source },
        merge_base_commit: { sha: source },
      },
    }),
    /not protected-main lineage/,
  );
});

test("release source verifier queries GitHub with scoped authentication", async () => {
  const source = "a".repeat(40);
  let observed = null;
  const result = await verifyReleaseSource({
    repo: "Wibias/github-delivery",
    sourceCommit: source,
    branch: "main",
    token: "test-token",
    async fetchImpl(url, options) {
      observed = { url: String(url), options };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: "identical",
            base_commit: { sha: source },
            merge_base_commit: { sha: source },
          };
        },
        async text() {
          return "";
        },
      };
    },
  });
  assert.equal(result.valid, true);
  assert.match(observed.url, /compare\/a{40}\.\.\.main$/);
  assert.equal(observed.options.headers.Authorization, "Bearer test-token");
});

test("distribution verification binds version, source commit, and checksums", () => {
  const { dist } = fixture();
  assert.equal(verifyDistribution({ dist, version: "0.1.0", sourceCommit: "a".repeat(40) }).valid, true);
  writeFileSync(join(dist, "github-delivery-v0.1.0.zip"), "tampered");
  assert.throws(() => verifyDistribution({ dist, version: "0.1.0", sourceCommit: "a".repeat(40) }), /checksum mismatch/);
});

test("creates an SPDX 2.3 SBOM for release artifacts", () => {
  const { dist } = fixture();
  const sbom = createSpdxSbom({ dist, version: "0.1.0", sourceCommit: "a".repeat(40) });
  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.equal(sbom.name, "github-delivery-v0.1.0");
  assert.equal(sbom.packages[0].versionInfo, "0.1.0");
  assert(sbom.files.some((file) => file.fileName.endsWith(".zip")));
});

test("extracts exact-version release notes", () => {
  const notes = releaseNotesForVersion("# Changelog\n\n## [0.1.0] - 2026-08-01\n\n- One\n\n## [0.0.9]\n\n- Old\n", "0.1.0");
  assert.match(notes, /One/);
  assert.doesNotMatch(notes, /Old/);
});

test("escapes regex special characters in version", () => {
  const notes = releaseNotesForVersion("# Changelog\n\n## [1.0.0-beta.1\\build] - 2026-08-01\n\n- Built\n", "1.0.0-beta.1\\build");
  assert.match(notes, /Built/);
});
