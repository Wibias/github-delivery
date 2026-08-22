import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createSpdxSbom,
  readGitCommitCreated,
  resolveSpdxCreated,
  validateReleaseContext,
  validateReleaseSourceComparison,
  verifyDistribution,
  releaseNotesForVersion,
} from "../../scripts/lib/release-contract.mjs";
import { validateSpdx23Document } from "../../scripts/lib/spdx-23-validate.mjs";
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

test("manual branch runs stay dry-run while tag-dispatched runs publish", () => {
  assert.deepEqual(validateReleaseContext({ eventName: "workflow_dispatch", ref: "refs/heads/main", version: "0.1.0" }), {
    version: "0.1.0", tag: "v0.1.0", publish: false,
  });
  assert.deepEqual(validateReleaseContext({ eventName: "workflow_dispatch", ref: "refs/tags/v0.1.0", version: "0.1.0" }), {
    version: "0.1.0", tag: "v0.1.0", publish: true,
  });
  assert.throws(() => validateReleaseContext({ eventName: "workflow_dispatch", ref: "refs/tags/v0.2.0", version: "0.1.0" }), /does not match package version/);
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
  const created = "2026-08-01T12:00:00Z";
  const sbom = createSpdxSbom({
    dist,
    version: "0.1.0",
    sourceCommit: "a".repeat(40),
    created,
  });
  const zip = readFileSync(join(dist, "github-delivery-v0.1.0.zip"));
  const tar = readFileSync(join(dist, "github-delivery-v0.1.0.tar.gz"));
  const verification = createHash("sha1")
    .update(
      [createHash("sha1").update(tar).digest("hex"), createHash("sha1").update(zip).digest("hex")].sort().join(""),
    )
    .digest("hex");
  const syntheticChecksum = createHash("sha256")
    .update(Buffer.from(sbom.files.map((file) => file.checksums[0].checksumValue).join("\n")))
    .digest("hex");

  assert.equal(sbom.spdxVersion, "SPDX-2.3");
  assert.equal(sbom.name, "github-delivery-v0.1.0");
  assert.deepEqual(sbom.documentDescribes, ["SPDXRef-Package-github-delivery"]);
  assert.equal(sbom.creationInfo.created, created);
  assert.equal(sbom.packages[0].versionInfo, "0.1.0");
  assert.equal(sbom.packages[0].packageVerificationCode.packageVerificationCodeValue, verification);
  assert.equal(sbom.packages[0].checksums, undefined);
  assert.notEqual(syntheticChecksum, verification);
  assert(sbom.files.some((file) => file.fileName.endsWith(".zip")));
  assert(sbom.relationships.some((rel) => (
    rel.spdxElementId === "SPDXRef-DOCUMENT"
    && rel.relationshipType === "DESCRIBES"
    && rel.relatedSpdxElement === "SPDXRef-Package-github-delivery"
  )));
  assert.equal(validateSpdx23Document(sbom).valid, true);
});

test("SPDX creation timestamps must be the source commit time, not the zip epoch", () => {
  assert.equal(resolveSpdxCreated("2026-08-01T14:00:00+02:00"), "2026-08-01T12:00:00Z");
  assert.throws(() => resolveSpdxCreated("1980-01-01T00:00:00Z"), /spdx_created_synthetic/);
  assert.throws(() => createSpdxSbom({
    dist: fixture().dist,
    version: "0.1.0",
    sourceCommit: "a".repeat(40),
  }), /spdx_created/);
});

test("git commit created timestamps fail closed when git evidence is missing", () => {
  assert.equal(
    readGitCommitCreated("a".repeat(40), {
      cwd: ".",
      spawn() {
        return { status: 0, stdout: "2026-08-22T07:11:00+02:00\n", stderr: "" };
      },
    }),
    "2026-08-22T05:11:00Z",
  );
  assert.throws(() => readGitCommitCreated("a".repeat(40), {
    cwd: ".",
    spawn() {
      return { status: 1, stdout: "", stderr: "fatal" };
    },
  }), /spdx_created_unavailable/);
});

test("SPDX validation rejects missing describes, synthetic checksums, and the zip epoch", () => {
  const { dist } = fixture();
  const sbom = createSpdxSbom({
    dist,
    version: "0.1.0",
    sourceCommit: "a".repeat(40),
    created: "2026-08-01T12:00:00Z",
  });
  const { documentDescribes: _documentDescribes, ...withoutDescribes } = sbom;

  assert.throws(() => validateSpdx23Document(withoutDescribes), /documentDescribes/);
  assert.throws(() => validateSpdx23Document({
    ...sbom,
    creationInfo: { ...sbom.creationInfo, created: "1980-01-01T00:00:00Z" },
  }), /spdx_created_synthetic/);
  assert.throws(() => validateSpdx23Document({
    ...sbom,
    packages: [{
      ...sbom.packages[0],
      checksums: [{
        algorithm: "SHA256",
        checksumValue: createHash("sha256")
          .update(Buffer.from(sbom.files.map((file) => file.checksums[0].checksumValue).join("\n")))
          .digest("hex"),
      }],
    }],
  }), /spdx_package_checksum_unbound/);
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
