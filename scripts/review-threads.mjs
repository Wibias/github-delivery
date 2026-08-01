#!/usr/bin/env node
/**
 * List unresolved review threads from one snapshot, or explicitly resolve one.
 * Usage:
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--snapshot FILE]
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER --resolve PRRT_xxx
 */
import { spawnSync } from "node:child_process";
import { captureLiveSnapshot } from "./lib/live-snapshot.mjs";
import { evaluateReviewThreadsSnapshot } from "./lib/snapshot-evaluators.mjs";
import {
  parseSnapshotGateArgs,
  readValidatedSnapshot,
} from "./lib/snapshot-input.mjs";

const usage =
  "Usage: node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--snapshot FILE] [--resolve PRRT_xxx] [--expected-head SHA] [--max-age-seconds N]";

function resolveThread(threadId) {
  const mutation = `
    mutation($id: ID!) {
      resolveReviewThread(input: { threadId: $id }) {
        thread { id isResolved }
      }
    }`;
  const result = spawnSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${mutation}`,
      "-F",
      `id=${threadId}`,
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `gh failed (${result.status})`);
  }
  const output = JSON.parse(result.stdout || "null");
  if (output?.errors?.length) throw new Error(JSON.stringify(output.errors));
  return output.data;
}

try {
  const args = parseSnapshotGateArgs(process.argv.slice(2), {
    usage,
    allowResolve: true,
  });
  if (args.resolveId) {
    process.stdout.write(`${JSON.stringify(resolveThread(args.resolveId), null, 2)}\n`);
    process.exit(0);
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
  const output = evaluateReviewThreadsSnapshot(snapshot);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = output.decision === "ready" ? 0 : output.decision === "blocked" ? 1 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
