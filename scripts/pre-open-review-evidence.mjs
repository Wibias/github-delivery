#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { isDirectInvocation } from "./lib/direct-invocation.mjs";
import { expandAggregatePreOpenEvidence } from "./lib/pre-open-evidence.mjs";

const USAGE = "Usage: node scripts/pre-open-review-evidence.mjs --summary FILE --review FILE [--output FILE]";

function parseArgs(argv) {
  let summary = null;
  let review = null;
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--summary") {
      summary = argv[++index];
      if (!summary) throw new Error("--summary requires a file path");
    } else if (value === "--review") {
      review = argv[++index];
      if (!review) throw new Error("--review requires a file path");
    } else if (value === "--output") {
      output = argv[++index];
      if (!output) throw new Error("--output requires a file path");
    } else {
      throw new Error(`unknown option: ${value}\n${USAGE}`);
    }
  }
  if (!summary || !review) throw new Error(USAGE);
  return {
    summary: resolve(summary),
    review: resolve(review),
    output: output ? resolve(output) : null,
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error?.message || error}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidence = expandAggregatePreOpenEvidence(
    readJson(args.summary, "pre_open_summary"),
    readJson(args.review, "pre_open_review"),
  );
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  process.stdout.write(json);
  if (args.output) writeFileSync(args.output, json, "utf8");
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
