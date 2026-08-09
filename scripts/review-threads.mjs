#!/usr/bin/env node
/**
 * List unresolved review threads from one snapshot, or plan exact broker requests
 * for explicitly selected resolutions. This helper never performs GitHub writes.
 *
 * Usage:
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--snapshot FILE]
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER --resolve PRRT_xxx --mutation-mode maintainer --explicit
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
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
  "Usage: node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--snapshot FILE] [--resolve PRRT_xxx] [--resolve-bot] [--expected-head SHA] [--max-age-seconds N] [--mutation-mode MODE] [--workflow WORKFLOW] [--explicit]";

const BOT_LOGIN_RE = /\[bot\]$/i;
const KNOWN_BOT_LOGINS = new Set([
  "coderabbitai[bot]",
  "chatgpt-codex-connector[bot]",
  "github-actions[bot]",
  "codex[bot]",
]);

export function isBotLogin(login) {
  if (!login) return false;
  return BOT_LOGIN_RE.test(login) || KNOWN_BOT_LOGINS.has(login);
}

function captureSnapshot(args) {
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
  if (args.expectedHead && snapshot.headOid !== args.expectedHead) {
    throw new Error(
      `expected_head_mismatch: expected ${args.expectedHead}, observed ${snapshot.headOid || "missing"}`,
    );
  }
  return snapshot;
}

function resolutionRequest({ args, mutationArgs, action, threadId, expectedHead }) {
  return {
    schemaVersion: 1,
    action,
    mutationMode: mutationArgs.mode,
    explicitInstruction: mutationArgs.explicitInstruction,
    repo: args.repo,
    pr: args.pr,
    expectedHead,
    threadId,
  };
}

function emitResolutionPlan({ args, mutationArgs, authorization, snapshot, requests }) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "github-delivery/thread-resolution-plan",
        executed: false,
        repo: args.repo,
        pr: args.pr,
        snapshotId: snapshot.snapshotId,
        expectedHead: snapshot.headOid,
        mutationMode: mutationArgs.mode,
        authorization,
        requests,
        workflow: args.workflow,
      },
      null,
      2,
    )}\n`,
  );
}

function main() {
  try {
    const mutationArgs = extractMutationModeArgs(process.argv.slice(2));
    const args = parseSnapshotGateArgs(mutationArgs.argv, {
      usage,
      allowResolve: true,
      allowResolveBot: true,
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
      const snapshot = captureSnapshot(args);
      const evaluation = evaluateReviewThreadsSnapshot(snapshot);
      if (evaluation.complete !== true) {
        throw new Error("resolve_thread_refused: review thread evidence is incomplete");
      }
      const target = (evaluation.unresolved || []).find(
        (thread) => thread.threadId === args.resolveId,
      );
      if (!target) {
        throw new Error(
          `resolve_thread_refused: ${args.resolveId} is not an unresolved thread in the validated snapshot`,
        );
      }
      emitResolutionPlan({
        args,
        mutationArgs,
        authorization,
        snapshot,
        requests: [
          resolutionRequest({
            args,
            mutationArgs,
            action: "resolve_thread",
            threadId: target.threadId,
            expectedHead: snapshot.headOid,
          }),
        ],
      });
      return;
    }

    if (args.resolveBot) {
      const authorization = authorizeMutation({
        mode: mutationArgs.mode,
        action: "resolve_bot_thread",
        explicitInstruction: mutationArgs.explicitInstruction,
      });
      if (!authorization.allowed) {
        throw new Error(
          `Mutation denied for resolve_bot_thread in ${authorization.mode}: ${authorization.reason}`,
        );
      }
      const snapshot = captureSnapshot(args);
      const evaluation = evaluateReviewThreadsSnapshot(snapshot);
      if (evaluation.complete !== true) {
        throw new Error("resolve_bot_thread_refused: review thread evidence is incomplete");
      }
      const unresolved = evaluation.unresolved || [];
      const botThreads = unresolved.filter((thread) => isBotLogin(thread.author));
      const humanThreads = unresolved.filter((thread) => !isBotLogin(thread.author));
      if (humanThreads.length) {
        throw new Error(
          `resolve_bot_thread_refused: ${humanThreads.length} unresolved human-authored thread(s) remain; use --resolve PRRT_xxx --mutation-mode maintainer --explicit for those`,
        );
      }
      emitResolutionPlan({
        args,
        mutationArgs,
        authorization,
        snapshot,
        requests: botThreads.map((thread) =>
          resolutionRequest({
            args,
            mutationArgs,
            action: "resolve_bot_thread",
            threadId: thread.threadId,
            expectedHead: snapshot.headOid,
          }),
        ),
      });
      return;
    }

    const snapshot = captureSnapshot(args);
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
}

if (process.argv[1]) {
  const invokedPath = realpathSync(process.argv[1]);
  if (import.meta.url === pathToFileURL(invokedPath).href) {
    main();
  }
}
