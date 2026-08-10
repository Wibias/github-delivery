#!/usr/bin/env node
import { readFileSync } from "node:fs";

import {
  compareBehaviouralScores,
  scoreBehaviouralRun,
} from "./lib/behavioural-evals.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  return "usage: node scripts/compare-behavioural-evals.mjs <cases.json> <baseline.json> <current.json> <candidate.json>";
}

const [casesPath, baselinePath, currentPath, candidatePath] = process.argv.slice(2);
if (!casesPath || !baselinePath || !currentPath || !candidatePath) {
  console.error(usage());
  process.exit(2);
}

try {
  const cases = readJson(casesPath);
  if (!Array.isArray(cases)) throw new TypeError("cases file must contain an array");
  const baseline = scoreBehaviouralRun(cases, readJson(baselinePath));
  const current = scoreBehaviouralRun(cases, readJson(currentPath));
  const candidate = scoreBehaviouralRun(cases, readJson(candidatePath));
  const comparison = compareBehaviouralScores(baseline, current, candidate);
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  if (!comparison.candidateImprovesOrMatchesCurrent) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
