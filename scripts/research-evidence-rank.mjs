#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { rankResearchEvidence } from "./lib/research-evidence-hierarchy.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/research-evidence-rank.mjs <claim.json>");
  process.exit(2);
}

try {
  const input = JSON.parse(readFileSync(path, "utf8"));
  const result = rankResearchEvidence(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.conflicted) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
