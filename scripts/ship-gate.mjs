#!/usr/bin/env node
/**
 * Produce one authoritative ship decision from one evidence snapshot.
 * Usage: node scripts/ship-gate.mjs OWNER/REPO PR_NUMBER [--snapshot FILE]
 */
import { captureLiveSnapshot } from "./lib/live-snapshot.mjs";
import {
  evaluateCodeownersSnapshot,
  evaluateRequiredChecksSnapshot,
  evaluateReviewPolicySnapshot,
  evaluateReviewThreadsSnapshot,
  evaluateWakeSnapshot,
} from "./lib/snapshot-evaluators.mjs";
import {
  parseSnapshotGateArgs,
  readValidatedSnapshot,
} from "./lib/snapshot-input.mjs";
import { combineShipGateResults } from "./lib/ship-gate-policy.mjs";

const usage =
  "Usage: node scripts/ship-gate.mjs OWNER/REPO PR_NUMBER [--snapshot FILE] [--expected-head SHA] [--max-age-seconds N]";

try {
  const args = parseSnapshotGateArgs(process.argv.slice(2), { usage });
  const snapshot = args.snapshotPath
    ? readValidatedSnapshot({
        path: args.snapshotPath,
        repo: args.repo,
        pr: args.pr,
        expectedHead: args.expectedHead,
        maxAgeSeconds: args.maxAgeSeconds,
      })
    : captureLiveSnapshot({
        repo: args.repo,
        pr: args.pr,
        maxAgeSeconds: args.maxAgeSeconds,
      });

  const output = combineShipGateResults({
    snapshot,
    requiredChecks: evaluateRequiredChecksSnapshot(snapshot),
    reviewPolicy: evaluateReviewPolicySnapshot(snapshot),
    reviewThreads: evaluateReviewThreadsSnapshot(snapshot),
    wake: evaluateWakeSnapshot(snapshot),
    codeowners: evaluateCodeownersSnapshot(snapshot),
  });

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.ready ? 0 : output.blocked ? 1 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
