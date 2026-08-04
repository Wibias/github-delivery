#!/usr/bin/env node
/**
 * List unresolved review threads from one snapshot, or explicitly resolve one.
 * Usage:
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--snapshot FILE]
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER --resolve PRRT_xxx --mutation-mode maintainer --explicit
 */
import { spawnSync } from "node:child_process";
import { captureLiveSnapshot } from "./lib/live-snapshot.mjs";
import {
  authorizeMutation,
  extractMutationModeArgs,
  mutationProfile,
} from "./lib/mutation-policy.mjs";
import { evaluateReviewThreadsSnapshot } from "./lib/snapshot-evaluators.mjs";
import {
  parseSnapshotGateArgs,
  readValidatedSnapshot,
} from "./lib/snapshot-input.mjs";
import { validateWorkflowMutationMode } from "./lib/workflow-mode.mjs";

const usage =
  "Usage: node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--snapshot FILE] [--resolve PRRT_xxx] [--expected-head SHA] [--max-age-seconds N] [--mutation-mode MODE] [--workflow WORKFLOW] [--explicit]";

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
  const mutationArgs = extractMutationModeArgs(process.argv.slice(2));
  const args = parseSnapshotGateArgs(mutationArgs.argv, {
    usage,
    allowResolve: true,
  });
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
  if (args.resolveId) {
    const authorization = authorizeMutation({
      mode: mutationArgs.mode,
      action: "resolve_thread",
      explicitInstruction: mutationArgs.explicitInstruction,
    });
    if (!authorization.allowed) {
      throw new Error(
        `Mutation denied for resolve_thread in ${authorization.mode}: ${authorization.reason}`,
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          mutationMode: mutationArgs.mode,
          authorization,
          data: resolveThread(args.resolveId),
          workflow: args.workflow,
        },
        null,
        2,
      )}\n`,
    );
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
  const output = {
    ...evaluateReviewThreadsSnapshot(snapshot),
    mutationMode: mutationArgs.mode,
    mutationProfile: mutationProfile(mutationArgs.mode),
    workflow: args.workflow,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode =
    output.decision === "ready"
      ? 0
      : output.decision === "blocked"
        ? 1
        : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
