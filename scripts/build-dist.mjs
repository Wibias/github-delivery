#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildDistribution, compareDirectories } from "./lib/distribution.mjs";

export function parseBuildArgs(argv) {
  const options = { root: process.cwd(), out: null, sourceCommit: undefined, verifyReproducible: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.root = argv[++index];
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--source-commit") options.sourceCommit = argv[++index];
    else if (arg === "--verify-reproducible") options.verifyReproducible = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  options.root = resolve(options.root);
  options.out = resolve(options.out || join(options.root, "dist"));
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseBuildArgs(argv);
  let reproducible = null;
  if (options.verifyReproducible) {
    const temporary = mkdtempSync(join(tmpdir(), "shipping-github-repro-"));
    const first = join(temporary, "first");
    const second = join(temporary, "second");
    try {
      buildDistribution({ root: options.root, out: first, sourceCommit: options.sourceCommit });
      buildDistribution({ root: options.root, out: second, sourceCommit: options.sourceCommit });
      const differences = compareDirectories(first, second);
      if (differences.length) {
        const error = new Error("distribution is not reproducible");
        error.differences = differences;
        throw error;
      }
      reproducible = true;
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  const result = buildDistribution({ root: options.root, out: options.out, sourceCommit: options.sourceCommit });
  process.stdout.write(`${JSON.stringify({ ...result, reproducible }, null, 2)}\n`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error), differences: error?.differences || [] }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
