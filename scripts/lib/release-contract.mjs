import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function requireVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || "") || version === "0.0.0") {
    throw new Error(`release version must be a non-zero semantic version: ${version}`);
  }
  return version;
}

function requireCommit(value, label = "source commit") {
  const commit = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${label} must be a 40-character SHA`);
  }
  return commit;
}

export function validateReleaseContext({ eventName, ref, version }) {
  version = requireVersion(version);
  const tag = `v${version}`;
  const releaseRef = String(ref || "");
  if (eventName === "workflow_dispatch" && !releaseRef.startsWith("refs/tags/")) {
    return { version, tag, publish: false };
  }
  if (!new Set(["push", "workflow_dispatch"]).has(eventName) || !releaseRef.startsWith("refs/tags/")) {
    throw new Error(`unsupported release context: ${eventName} ${ref}`);
  }
  const actualTag = releaseRef.slice("refs/tags/".length);
  if (actualTag !== tag) throw new Error(`release tag ${actualTag} does not match package version ${version}`);
  return { version, tag, publish: true };
}

export function validateReleaseSourceComparison({ sourceCommit, branch, comparison } = {}) {
  const source = requireCommit(sourceCommit);
  const targetBranch = String(branch || "").trim();
  if (!targetBranch) throw new Error("release branch is required");
  if (!comparison || typeof comparison !== "object" || Array.isArray(comparison)) {
    throw new Error("release source comparison is missing");
  }

  const base = requireCommit(comparison.base_commit?.sha, "comparison base commit");
  const mergeBase = requireCommit(comparison.merge_base_commit?.sha, "comparison merge-base commit");
  const status = String(comparison.status || "").toLowerCase();

  if (base !== source) {
    throw new Error(`release comparison base ${base} does not match source commit ${source}`);
  }
  if (mergeBase !== source) {
    throw new Error(`release source ${source} is not an ancestor of ${targetBranch}`);
  }
  if (!new Set(["ahead", "identical"]).has(status)) {
    throw new Error(`release source comparison status ${status || "missing"} is not protected-main lineage`);
  }

  return {
    valid: true,
    sourceCommit: source,
    branch: targetBranch,
    status,
    mergeBase,
  };
}

function parseSums(source) {
  const entries = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
    if (entries.has(match[2])) throw new Error(`duplicate checksum entry: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

export function verifyDistribution({ dist, version, sourceCommit }) {
  dist = resolve(dist);
  version = requireVersion(version);
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit || "")) throw new Error("source commit must be a 40-character SHA");
  const manifestPath = join(dist, "manifest.json");
  const sumsPath = join(dist, "SHA256SUMS");
  if (!existsSync(manifestPath) || !existsSync(sumsPath)) throw new Error("distribution manifest or checksums are missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.kind !== "github-delivery/distribution-manifest" || manifest.schemaVersion !== 1) throw new Error("unsupported distribution manifest");
  if (manifest.name !== "github-delivery" || manifest.version !== version) throw new Error("distribution version does not match package version");
  if (manifest.sourceCommit !== sourceCommit.toLowerCase()) throw new Error("distribution source commit does not match release commit");
  const expectedNames = ["manifest.json", `github-delivery-v${version}.tar.gz`, `github-delivery-v${version}.zip`];
  const sums = parseSums(readFileSync(sumsPath, "utf8"));
  for (const name of expectedNames) {
    const path = join(dist, name);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`release artifact is missing: ${name}`);
    const expected = sums.get(name);
    if (!expected) throw new Error(`checksum entry is missing: ${name}`);
    const actual = sha256(readFileSync(path));
    if (actual !== expected) throw new Error(`checksum mismatch: ${name}`);
  }
  if (sums.size !== expectedNames.length) throw new Error("SHA256SUMS contains unexpected release subjects");
  return { valid: true, manifest, artifacts: expectedNames.filter((name) => name !== "manifest.json") };
}

function artifactFiles(dist) {
  return readdirSync(dist)
    .filter((name) => /\.(?:zip|tar\.gz)$/.test(name))
    .sort()
    .map((name, index) => {
      const content = readFileSync(join(dist, name));
      return {
        SPDXID: `SPDXRef-File-${index + 1}`,
        fileName: name,
        checksums: [{ algorithm: "SHA256", checksumValue: sha256(content) }],
      };
    });
}

export function createSpdxSbom({ dist, version, sourceCommit }) {
  dist = resolve(dist);
  version = requireVersion(version);
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit || "")) throw new Error("source commit must be a 40-character SHA");
  const files = artifactFiles(dist);
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `github-delivery-v${version}`,
    documentNamespace: `https://github.com/Wibias/github-delivery/releases/tag/v${version}#${sourceCommit}`,
    creationInfo: {
      creators: ["Organization: Wibias", "Tool: github-delivery-release-contract/1"],
      created: "1980-01-01T00:00:00Z",
    },
    packages: [{
      name: "github-delivery",
      SPDXID: "SPDXRef-Package-github-delivery",
      versionInfo: version,
      downloadLocation: `https://github.com/Wibias/github-delivery/releases/tag/v${version}`,
      filesAnalyzed: true,
      licenseConcluded: "MIT",
      licenseDeclared: "MIT",
      checksums: [{ algorithm: "SHA256", checksumValue: sha256(Buffer.from(files.map((file) => file.checksums[0].checksumValue).join("\n"))) }],
    }],
    files,
    relationships: files.map((file) => ({
      spdxElementId: "SPDXRef-Package-github-delivery",
      relationshipType: "CONTAINS",
      relatedSpdxElement: file.SPDXID,
    })),
  };
}

export function releaseNotesForVersion(changelog, version) {
  const escaped = version.replace(/[.\\]/g, (char) => `\\${char}`);
  const match = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, "m").exec(changelog.replace(/\r\n?/g, "\n"));
  if (!match || !match[1].trim()) throw new Error(`CHANGELOG.md has no release notes for ${version}`);
  return `# github-delivery v${version}\n\n${match[1].trim()}\n`;
}
