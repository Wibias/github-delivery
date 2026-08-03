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

export function validateReleaseContext({ eventName, ref, version }) {
  version = requireVersion(version);
  const tag = `v${version}`;
  if (eventName === "workflow_dispatch") return { version, tag, publish: false };
  if (eventName !== "push" || !String(ref).startsWith("refs/tags/")) {
    throw new Error(`unsupported release context: ${eventName} ${ref}`);
  }
  const actualTag = String(ref).slice("refs/tags/".length);
  if (actualTag !== tag) throw new Error(`release tag ${actualTag} does not match package version ${version}`);
  return { version, tag, publish: true };
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
  if (manifest.kind !== "shipping-github/distribution-manifest" || manifest.schemaVersion !== 1) throw new Error("unsupported distribution manifest");
  if (manifest.name !== "shipping-github" || manifest.version !== version) throw new Error("distribution version does not match package version");
  if (manifest.sourceCommit !== sourceCommit.toLowerCase()) throw new Error("distribution source commit does not match release commit");
  const expectedNames = ["manifest.json", `shipping-github-v${version}.tar.gz`, `shipping-github-v${version}.zip`];
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
    name: `shipping-github-v${version}`,
    documentNamespace: `https://github.com/Wibias/shipping-github/releases/tag/v${version}#${sourceCommit}`,
    creationInfo: {
      creators: ["Organization: Wibias", "Tool: shipping-github-release-contract/1"],
      created: "1980-01-01T00:00:00Z",
    },
    packages: [{
      name: "shipping-github",
      SPDXID: "SPDXRef-Package-shipping-github",
      versionInfo: version,
      downloadLocation: `https://github.com/Wibias/shipping-github/releases/tag/v${version}`,
      filesAnalyzed: true,
      licenseConcluded: "MIT",
      licenseDeclared: "MIT",
      checksums: [{ algorithm: "SHA256", checksumValue: sha256(Buffer.from(files.map((file) => file.checksums[0].checksumValue).join("\n"))) }],
    }],
    files,
    relationships: files.map((file) => ({
      spdxElementId: "SPDXRef-Package-shipping-github",
      relationshipType: "CONTAINS",
      relatedSpdxElement: file.SPDXID,
    })),
  };
}

export function releaseNotesForVersion(changelog, version) {
  const escaped = version.replace(/[.\\]/g, (char) => `\\${char}`);
  const match = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, "m").exec(changelog.replace(/\r\n?/g, "\n"));
  if (!match || !match[1].trim()) throw new Error(`CHANGELOG.md has no release notes for ${version}`);
  return `# shipping-github v${version}\n\n${match[1].trim()}\n`;
}
