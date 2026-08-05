#!/usr/bin/env node
/**
 * Verify a review run emitted machine-checkable probe-application evidence for
 * every required probe.
 *
 * Input:
 *   --scope-file <json>   the bug/security scope projection JSON (must include
 *                         `requiredProbes` and `probeEvidence`)
 *   --evidence-file <json> the probe-evidence map the agent produced
 *   --evidence-inline <json> optional inline evidence (when no file was written)
 *
 * Exit:
 *   0  every required probe has valid evidence
 *   1  evidence is missing/invalid for at least one required probe
 *   2  the verifier itself failed (bad args, unreadable file)
 *
 * Usage:
 *   node scripts/verify-probe-coverage.mjs \
 *     --scope-file scope.json --evidence-file evidence.json
 */
import { readFileSync } from "node:fs";

import { PROBE_EVIDENCE_SCHEMA_VERSION, validateProbeEvidence } from "./lib/probe-evidence.mjs";

const usage =
  "Usage: node scripts/verify-probe-coverage.mjs --scope-file SCOPE.json --evidence-file EVIDENCE.json | --evidence-inline JSON";

function parseArgs(argv) {
  const options = { scopeFile: null, evidenceFile: null, evidenceInline: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--scope-file") {
      options.scopeFile = argv[++index];
      if (!options.scopeFile) throw new Error("--scope-file requires a path");
    } else if (value === "--evidence-file") {
      options.evidenceFile = argv[++index];
      if (!options.evidenceFile) throw new Error("--evidence-file requires a path");
    } else if (value === "--evidence-inline") {
      options.evidenceInline = argv[++index];
      if (!options.evidenceInline) throw new Error("--evidence-inline requires JSON");
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      throw new Error(`Unexpected positional: ${value}`);
    }
  }
  if (!options.scopeFile) throw new Error(usage);
  if (!options.evidenceFile && !options.evidenceInline) throw new Error(usage);
  if (options.evidenceFile && options.evidenceInline) {
    throw new Error("Provide either --evidence-file or --evidence-inline, not both");
  }
  return options;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const scope = JSON.parse(readFileSync(args.scopeFile, "utf8"));
  const evidence = args.evidenceFile
    ? JSON.parse(readFileSync(args.evidenceFile, "utf8"))
    : JSON.parse(args.evidenceInline);
  const errors = validateProbeEvidence(evidence, scope);
  const output = {
    schemaVersion: PROBE_EVIDENCE_SCHEMA_VERSION,
    kind: "github-delivery/probe-coverage-check",
    valid: errors.length === 0,
    requiredProbes: (scope.requiredProbes || []).slice(),
    providedProbes: Object.keys(evidence || {}).slice().sort(),
    errors,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = errors.length === 0 ? 0 : 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
