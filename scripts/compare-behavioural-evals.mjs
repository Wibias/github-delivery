#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

import {
  compareBehaviouralScores,
  scoreBehaviouralRun,
} from "./lib/behavioural-evals.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function transcriptPath(runPath) {
  return String(runPath).replace(/\.json$/i, ".transcript.json");
}

function scoreRunFile(cases, runPath) {
  const sidecar = transcriptPath(runPath);
  if (!existsSync(sidecar)) throw new TypeError(`missing transcripts sidecar: ${sidecar}`);
  return scoreBehaviouralRun(cases, readJson(runPath), readJson(sidecar));
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
  const baseline = scoreRunFile(cases, baselinePath);
  const current = scoreRunFile(cases, currentPath);
  const candidate = scoreRunFile(cases, candidatePath);
  const comparison = compareBehaviouralScores(baseline, current, candidate);
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  if (!comparison.candidateImprovesOrMatchesCurrent) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
