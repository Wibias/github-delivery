#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { buildReviewContext, REVIEW_CONTEXT_PHASES } from "./lib/review-context.mjs";

function usage() {
  return "usage: node scripts/review-context.mjs <context.json> [--phase blind-discovery|context-reconciliation]";
}

const args = process.argv.slice(2);
const inputPath = args[0];
const phaseIndex = args.indexOf("--phase");
const phase = phaseIndex >= 0 ? args[phaseIndex + 1] : REVIEW_CONTEXT_PHASES.BLIND_DISCOVERY;

if (!inputPath || (phaseIndex >= 0 && !phase)) {
  console.error(usage());
  process.exit(2);
}

try {
  const input = JSON.parse(readFileSync(inputPath, "utf8"));
  const result = buildReviewContext(input, { phase });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(1);
}
