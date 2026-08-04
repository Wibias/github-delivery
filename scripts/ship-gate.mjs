#!/usr/bin/env node
/**
 * Produce one authoritative ship decision from one evidence snapshot.
 * Usage: node scripts/ship-gate.mjs OWNER/REPO PR_NUMBER [--snapshot FILE]
 */
import { captureLiveSnapshot } from "./lib/live-snapshot.mjs";
import { evaluateBaseHealthSnapshot } from "./lib/base-health-policy.mjs";
import {
  extractMutationModeArgs,
  mutationProfile,
} from "./lib/mutation-policy.mjs";
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
import { validateWorkflowMutationMode } from "./lib/workflow-mode.mjs";

const usage =
  "Usage: node scripts/ship-gate.mjs OWNER/REPO PR_NUMBER [--snapshot FILE] [--expected-head SHA] [--max-age-seconds N] [--mutation-mode MODE] [--workflow WORKFLOW]";

try {
  const mutationArgs = extractMutationModeArgs(process.argv.slice(2));
  const args = parseSnapshotGateArgs(mutationArgs.argv, { usage });
  if (args.workflow) {
    const compatibility = validateWorkflowMutationMode({
      workflow: args.workflow,
      mutationMode: mutationArgs.mode,
    });
    if (!compatibility.valid) {
      throw new Error(
        `Mutation mode "${compatibility.mutationMode}" is not compatible with workflow "${args.workflow}": ${compatibility.reason}${compatibility.allowedModes.length ? ` (allowed: ${compatibility.allowedModes.join(", ")})` : ""}`,
      );
    }
  }
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
    mutationProfile: mutationProfile(mutationArgs.mode),
    requiredChecks: evaluateRequiredChecksSnapshot(snapshot),
    baseHealth: evaluateBaseHealthSnapshot(snapshot),
    reviewPolicy: evaluateReviewPolicySnapshot(snapshot),
    reviewThreads: evaluateReviewThreadsSnapshot(snapshot),
    wake: evaluateWakeSnapshot(snapshot),
    codeowners: evaluateCodeownersSnapshot(snapshot),
  });
  output.workflow = args.workflow;

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.ready ? 0 : output.blocked ? 1 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
