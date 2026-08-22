#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  createSpdxSbom,
  readGitCommitCreated,
  releaseNotesForVersion,
  validateReleaseContext,
  verifyDistribution,
} from "./lib/release-contract.mjs";

function args(argv) {
  const output = { root: process.cwd(), dist: null, eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, sourceCommit: process.env.GITHUB_SHA, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") output.root = argv[++index];
    else if (arg === "--dist") output.dist = argv[++index];
    else if (arg === "--event") output.eventName = argv[++index];
    else if (arg === "--ref") output.ref = argv[++index];
    else if (arg === "--source-commit") output.sourceCommit = argv[++index];
    else if (arg === "--out") output.out = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  output.root = resolve(output.root);
  output.dist = resolve(output.dist || join(output.root, "dist"));
  output.out = resolve(output.out || join(output.dist, "release-metadata.json"));
  return output;
}

export function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  const pkg = JSON.parse(readFileSync(join(options.root, "package.json"), "utf8"));
  const context = validateReleaseContext({ eventName: options.eventName, ref: options.ref, version: pkg.version });
  const verified = verifyDistribution({ dist: options.dist, version: pkg.version, sourceCommit: options.sourceCommit });
  const created = readGitCommitCreated(options.sourceCommit, { cwd: options.root });
  const sbom = createSpdxSbom({
    dist: options.dist,
    version: pkg.version,
    sourceCommit: options.sourceCommit,
    created,
  });
  const notes = releaseNotesForVersion(readFileSync(join(options.root, "CHANGELOG.md"), "utf8"), pkg.version);
  const sbomPath = join(options.dist, "sbom.spdx.json");
  const notesPath = join(options.dist, "RELEASE_NOTES.md");
  writeFileSync(sbomPath, JSON.stringify(sbom, null, 2) + "\n");
  writeFileSync(notesPath, notes);
  const report = {
    schemaVersion: 1,
    kind: "github-delivery/release-preparation",
    ...context,
    sourceCommit: options.sourceCommit,
    artifacts: verified.artifacts,
    manifest: "manifest.json",
    checksums: "SHA256SUMS",
    sbom: "sbom.spdx.json",
    notes: "RELEASE_NOTES.md",
  };
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) }, null, 2)}\n`);
  process.exitCode = 1;
}
