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

function scoreRunFile(cases, runPath, options) {
  const sidecar = transcriptPath(runPath);
  if (!existsSync(sidecar)) throw new TypeError(`missing transcripts sidecar: ${sidecar}`);
  return scoreBehaviouralRun(cases, readJson(runPath), readJson(sidecar), options);
}

function usage() {
  return "usage: node scripts/compare-behavioural-evals.mjs [--require-trusted --attestation-public-key FILE] <cases.json> <baseline.json> <current.json> <candidate.json>";
}

function parseArgs(argv) {
  const positional = [];
  let requireTrusted = false;
  let publicKeyPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--require-trusted") {
      requireTrusted = true;
    } else if (value === "--attestation-public-key") {
      publicKeyPath = argv[++index];
      if (!publicKeyPath) throw new TypeError("--attestation-public-key requires a file");
    } else {
      positional.push(value);
    }
  }
  if (positional.length !== 4) throw new TypeError(usage());
  if (requireTrusted && !publicKeyPath) {
    throw new TypeError("--require-trusted requires --attestation-public-key");
  }
  return {
    casesPath: positional[0],
    baselinePath: positional[1],
    currentPath: positional[2],
    candidatePath: positional[3],
    requireTrusted,
    publicKeyPath,
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const cases = readJson(args.casesPath);
  if (!Array.isArray(cases)) throw new TypeError("cases file must contain an array");
  const options = args.publicKeyPath
    ? { attestationPublicKey: readFileSync(args.publicKeyPath, "utf8") }
    : {};
  const baseline = scoreRunFile(cases, args.baselinePath, options);
  const current = scoreRunFile(cases, args.currentPath, options);
  const candidate = scoreRunFile(cases, args.candidatePath, options);
  const comparison = compareBehaviouralScores(baseline, current, candidate);
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  if (!comparison.candidateImprovesOrMatchesCurrent) process.exitCode = 1;
  if (args.requireTrusted && !comparison.trustedGatingEligible) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
