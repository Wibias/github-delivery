#!/usr/bin/env node
/**
 * High-level merge driver: collapse the merge-pr ceremony into one call.
 *
 * Chains the existing gates, broker, and cleanup evaluators so the agent
 * reviews one plan and confirms execution instead of hand-rolling each step.
 * Usage:
 *   node scripts/merge-pr-driver.mjs OWNER/REPO N [--mode maintainer] [--settle]
 *     [--merge-method merge|squash|rebase] [--execute] [--audit FILE]
 *     [--expected-head SHA] [--thank-comment BODY] [--skip-thanks]
 *
 * Dry-run (default) prints the full plan and the exact commands that would run.
 * --execute performs the writes through the broker only after the gate is
 * ready on the pinned head. Never merges when blocked or head-mismatched.
 */
import { appendFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { captureLiveSnapshot } from "./lib/live-snapshot.mjs";
import {
  evaluateCodeownersSnapshot,
  evaluateRequiredChecksSnapshot,
  evaluateReviewPolicySnapshot,
  evaluateReviewThreadsSnapshot,
  evaluateWakeSnapshot,
} from "./lib/snapshot-evaluators.mjs";
import { evaluateBaseHealthSnapshot } from "./lib/base-health-policy.mjs";
import { combineShipGateResults } from "./lib/ship-gate-policy.mjs";
import { mutationProfile, normalizeMutationMode } from "./lib/mutation-policy.mjs";
import {
  executeMutationRequest,
  planMutationRequest,
} from "./lib/github-mutation-broker.mjs";
import { evaluateHeadBranchCleanup } from "./lib/merge-branch-cleanup.mjs";

const USAGE =
  "Usage: node scripts/merge-pr-driver.mjs OWNER/REPO N [--mode MODE] [--settle] [--merge-method METHOD] [--execute] [--audit FILE] [--expected-head SHA] [--thank-comment BODY] [--skip-thanks]";

function parseArgs(argv) {
  const positional = [];
  const options = {
    mode: "maintainer",
    settle: false,
    mergeMethod: null,
    execute: false,
    audit: null,
    expectedHead: null,
    thankComment: null,
    skipThanks: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--mode") {
      options.mode = argv[++index];
      if (!options.mode) throw new Error("--mode requires a value");
    } else if (value === "--settle") {
      options.settle = true;
    } else if (value === "--merge-method") {
      options.mergeMethod = argv[++index];
      if (!options.mergeMethod) throw new Error("--merge-method requires a value");
    } else if (value === "--execute") {
      options.execute = true;
    } else if (value === "--audit") {
      options.audit = argv[++index];
      if (!options.audit) throw new Error("--audit requires a file path");
    } else if (value === "--expected-head") {
      options.expectedHead = argv[++index];
      if (!options.expectedHead) throw new Error("--expected-head requires a SHA");
    } else if (value === "--thank-comment") {
      options.thankComment = argv[++index];
      if (!options.thankComment) throw new Error("--thank-comment requires a body");
    } else if (value === "--skip-thanks") {
      options.skipThanks = true;
    } else {
      positional.push(value);
    }
  }
  if (positional.length !== 2) throw new Error(USAGE);
  const repo = positional[0];
  const pr = Number(positional[1]);
  if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) throw new Error(USAGE);
  if (!["merge", "squash", "rebase"].includes(options.mergeMethod || "merge")) {
    throw new Error("--merge-method must be merge, squash, or rebase");
  }
  return { repo, pr, ...options };
}

export function buildGateOutput(snapshot, mode) {
  return combineShipGateResults({
    snapshot,
    mutationProfile: mutationProfile(mode),
    requiredChecks: evaluateRequiredChecksSnapshot(snapshot),
    baseHealth: evaluateBaseHealthSnapshot(snapshot),
    reviewPolicy: evaluateReviewPolicySnapshot(snapshot),
    reviewThreads: evaluateReviewThreadsSnapshot(snapshot),
    wake: evaluateWakeSnapshot(snapshot),
    codeowners: evaluateCodeownersSnapshot(snapshot),
  });
}

export function defaultThanksBody({ author, repo, pr, title }) {
  return `Thanks @${author} - merging this. This PR addresses the tracked work cleanly and has passed the full review + CI bar on the current head. Ship it.`;
}

export function buildThankRequest({ repo, pr, expectedHead, body }) {
  return {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo,
    pr,
    expectedHead,
    idempotencyKey: `merge-thanks-pr-${pr}`,
    body,
  };
}

export function buildMergeRequest({ repo, pr, expectedHead, mergeMethod }) {
  return {
    schemaVersion: 1,
    action: "merge_pr",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo,
    pr,
    expectedHead,
    mergeMethod,
  };
}

export function detectMergeMethod() {
  return "merge";
}

async function settle({ repo, pr, mode, snapshot, totalMs = 60_000, pollMs = 20_000 }) {
  const deadline = Date.now() + totalMs;
  let gate = buildGateOutput(snapshot, mode);
  let lastHead = snapshot.headOid;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const fresh = captureLiveSnapshot({ repo, pr });
    if (fresh.headOid !== lastHead) {
      return { ok: false, reason: "head_moved_during_settle", headOid: fresh.headOid, gate };
    }
    gate = buildGateOutput(fresh, mode);
    snapshot = fresh;
    if (!gate.ready) {
      return { ok: false, reason: "gate_left_ready_during_settle", blockers: gate.blockers, gate };
    }
  }
  return { ok: true, gate, snapshot };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = normalizeMutationMode(args.mode);
  if (!mutationProfile(mode).actions.merge_pr?.allowed) {
    throw new Error(`mutation_mode_merge_forbidden:${mode}`);
  }

  let snapshot = captureLiveSnapshot({ repo: args.repo, pr: args.pr });
  if (args.expectedHead && snapshot.headOid !== String(args.expectedHead).toLowerCase()) {
    throw new Error(
      `expected_head_mismatch: expected ${args.expectedHead}, observed ${snapshot.headOid}`,
    );
  }
  const pr = snapshot.evidence?.pullRequest || {};
  if (pr.state === "MERGED") {
    throw new Error("pr_already_merged");
  }
  if (pr.isDraft === true) {
    throw new Error("pr_is_draft");
  }

  let gate = buildGateOutput(snapshot, mode);
  if (!gate.ready) {
    throw new Error(`gate_blocked:${(gate.blockers || []).join(",") || "unknown"}`);
  }

  if (args.settle) {
    const settled = await settle({ repo: args.repo, pr: args.pr, mode, snapshot });
    if (!settled.ok) {
      throw new Error(`settle_failed:${settled.reason}`);
    }
    snapshot = settled.snapshot;
    gate = settled.gate;
  }

  const expectedHead = snapshot.headOid;
  const mergeMethod = args.mergeMethod || detectMergeMethod();
  const authorLogin = pr.author?.login || null;
  const thankBody =
    args.thankComment ||
    (authorLogin && !args.skipThanks
      ? defaultThanksBody({ author: authorLogin, repo: args.repo, pr: args.pr, title: pr.title })
      : null);

  const requests = [];
  if (thankBody) {
    requests.push({
      name: "pre_merge_thanks",
      request: buildThankRequest({ repo: args.repo, pr: args.pr, expectedHead, body: thankBody }),
    });
  }
  requests.push({
    name: "merge",
    request: buildMergeRequest({ repo: args.repo, pr: args.pr, expectedHead, mergeMethod }),
  });

  const plans = requests.map(({ name, request }) => ({
    name,
    plan: planMutationRequest(request),
  }));

  const summary = {
    schemaVersion: 1,
    kind: "github-delivery/merge-pr-driver",
    repo: args.repo,
    pr: args.pr,
    mode,
    headOid: expectedHead,
    gate: {
      decision: gate.decision,
      ready: gate.ready,
      blockers: gate.blockers,
    },
    settle: args.settle,
    mergeMethod,
    author: authorLogin,
    steps: plans.map(({ name, plan }) => ({
      name,
      action: plan.action,
      command: plan.command,
      requestHash: plan.requestHash,
    })),
    executed: false,
  };

  if (!args.execute) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const receipts = [];
  for (const { name, request } of requests) {
    const receipt = executeMutationRequest({ request, execute: true });
    receipts.push({ name, receipt });
    if (args.audit) {
      appendFileSync(args.audit, `${JSON.stringify(receipt)}\n`, "utf8");
    }
  }

  const merged = receipts.find((item) => item.name === "merge")?.receipt;
  const cleanup = evaluateHeadBranchCleanup({
    actorLogin: process.env.GH_ACTOR_LOGIN || null,
    headOwnerLogin: null,
    headRefName: null,
    isMerged: merged?.status === "succeeded",
  });

  const final = {
    ...summary,
    executed: true,
    receipts: receipts.map(({ name, receipt }) => ({
      name,
      action: receipt.action,
      status: receipt.status,
      observedHead: receipt.observedHead,
      verification: receipt.verification,
    })),
    cleanup: {
      action: cleanup.action,
      reason: cleanup.reason,
      status: cleanup.status || null,
    },
  };
  process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);
}

if (process.argv[1]) {
  const invokedPath = realpathSync(process.argv[1]);
  if (import.meta.url === pathToFileURL(invokedPath).href) {
    main().catch((error) => {
      console.error(String(error?.message || error));
      process.exit(2);
    });
  }
}
