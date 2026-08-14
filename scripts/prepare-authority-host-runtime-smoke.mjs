#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildAuthorityHostRelease } from "./build-authority-host-release.mjs";
import { extractVerifiedAuthorityHostZip } from "./lib/authority-host-release.mjs";

function fail(code) {
  throw new Error(code);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--publish-dir") options.publishDir = resolve(argv[++index]);
    else if (arg === "--workspace") options.workspace = resolve(argv[++index]);
    else if (arg === "--version") options.version = argv[++index];
    else if (arg === "--source-commit") options.sourceCommit = argv[++index];
    else fail("authority_host_smoke_argument_unknown");
  }
  if (!options.publishDir || !options.workspace || !options.version || !options.sourceCommit) {
    fail("authority_host_smoke_arguments_required");
  }
  return options;
}

export function prepareAuthorityHostRuntimeSmoke(options) {
  const built = buildAuthorityHostRelease({
    publishDir: options.publishDir,
    outDir: resolve(options.workspace, "release"),
    version: options.version,
    sourceCommit: options.sourceCommit,
  });
  const extracted = extractVerifiedAuthorityHostZip({
    archive: readFileSync(built.archivePath),
    metadata: built.metadata,
    destination: resolve(options.workspace, "extracted"),
  });
  return {
    source: extracted.root,
    archivePath: built.archivePath,
    metadataPath: built.metadataPath,
    files: extracted.files.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(prepareAuthorityHostRuntimeSmoke(parseArgs(process.argv.slice(2))))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}
