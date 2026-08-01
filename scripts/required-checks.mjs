#!/usr/bin/env node
/**
 * Resolve required CI checks against one evidence snapshot.
 * Usage: node scripts/required-checks.mjs OWNER/REPO PR_NUMBER [--snapshot FILE]
 */
import { captureLiveSnapshot } from "./lib/live-snapshot.mjs";
import { evaluateRequiredChecksSnapshot } from "./lib/snapshot-evaluators.mjs";
import {
  parseSnapshotGateArgs,
  readValidatedSnapshot,
} from "./lib/snapshot-input.mjs";

const usage =
  "Usage: node scripts/required-checks.mjs OWNER/REPO PR_NUMBER [--snapshot FILE] [--expected-head SHA] [--max-age-seconds N]";

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
  const output = evaluateRequiredChecksSnapshot(snapshot);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.decision === "ready" ? 0 : output.decision === "blocked" ? 1 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
