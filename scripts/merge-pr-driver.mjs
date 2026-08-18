#!/usr/bin/env node
/**
 * High-level merge driver: collapse the merge-pr ceremony into one call.
 *
 * Chains the existing gates, broker, review evidence, and cleanup evaluators so
 * the agent reviews one plan instead of hand-rolling each step.
 */
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { appendFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { attachAuthorityGrants } from "./lib/authority-batch.mjs";
import { authorizeBatchSync } from "./lib/authority-host-client.mjs";
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
  executeMutationWithAuthority,
  planMutationWithAuthority,
} from "./lib/mutation-execution-context.mjs";
import { evaluateHeadBranchCleanup } from "./lib/merge-branch-cleanup.mjs";
import {
  assertSameMergeBoundary,
  mergeBoundaryForSnapshot,
} from "./lib/merge-boundary.mjs";
import {
  assertSameMergeReviewEvidence,
  mergeReviewEvidenceForSnapshot,
} from "./lib/merge-review-evidence.mjs";

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

export function defaultThanksBody({ author }) {
  return `Thanks @${author} - merged successfully. This PR addresses the tracked work cleanly and passed the full review + CI bar on the merged head.`;
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

export function authorizeMergeRequests(
  requests,
  {
    authorize = authorizeBatchSync,
    pipeName = process.env.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined,
  } = {},
) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error("merge_authority_requests_required");
  }
  const operations = requests.map(({ request }) => request);
  const authorization = authorize(operations, { pipeName });
  const batch = attachAuthorityGrants(operations, authorization);
  return {
    batchId: batch.batchId,
    expiresAt: batch.expiresAt,
    requests: requests.map((entry, index) => ({
      ...entry,
      request: batch.requests[index],
    })),
  };
}

export function isFinalMergeOutcome(receipt) {
  return receipt?.outcome === "merged" || receipt?.outcome === "already_merged";
}

export function executeMergeTransaction({
  mergeRequest,
  thankRequest = null,
  beforeMerge = null,
  executeRequest = (request) => executeMutationWithAuthority({ request, execute: true }),
} = {}) {
  if (!mergeRequest) throw new Error("merge_request_required");
  const receipts = [];
  if (beforeMerge) beforeMerge();
  const mergeReceipt = executeRequest(mergeRequest);
  receipts.push({ name: "merge", receipt: mergeReceipt });
  if (!isFinalMergeOutcome(mergeReceipt)) return receipts;
  if (thankRequest) {
    try {
      const thankReceipt = executeRequest(thankRequest);
      receipts.push({ name: "post_merge_thanks", receipt: thankReceipt });
    } catch (error) {
      receipts.push({
        name: "post_merge_thanks",
        receipt: null,
        error: String(error?.message || error),
      });
    }
  }
  return receipts;
}

function booleanCapability(capabilities, camel, snake) {
  if (capabilities?.[camel] === true || capabilities?.[snake] === true) return true;
  if (capabilities?.[camel] === false || capabilities?.[snake] === false) return false;
  return null;
}

export function detectMergeMethod(capabilities = null) {
  if (!capabilities) return "merge";
  const candidates = [
    ["merge", booleanCapability(capabilities, "mergeCommitAllowed", "allow_merge_commit")],
    ["squash", booleanCapability(capabilities, "squashMergeAllowed", "allow_squash_merge")],
    ["rebase", booleanCapability(capabilities, "rebaseMergeAllowed", "allow_rebase_merge")],
  ];
  const enabled = candidates.filter(([, allowed]) => allowed === true).map(([method]) => method);
  if (!enabled.length) throw new Error("repository_has_no_enabled_merge_method");
  return enabled[0];
}

export function readRepositoryMergeCapabilities(
  repo,
  runner = boundedSpawnSync,
) {
  const result = runner("gh", ["api", `repos/${repo}`], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `repository_capabilities_failed:${result.status}`);
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout || ""));
  } catch {
    throw new Error("repository_capabilities_invalid_json");
  }
  return {
    mergeCommitAllowed: payload.allow_merge_commit === true,
    squashMergeAllowed: payload.allow_squash_merge === true,
    rebaseMergeAllowed: payload.allow_rebase_merge === true,
  };
}

async function settle({ repo, pr, mode, snapshot, totalMs = 60_000, pollMs = 20_000 }) {
  const deadline = Date.now() + totalMs;
  let gate = buildGateOutput(snapshot, mode);
  const lastHead = snapshot.headOid;
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

export function verifyFinalMergeBoundary({
  approvedBoundary,
  approvedReviewEvidence,
  freshSnapshot,
  mode,
}) {
  const freshGate = buildGateOutput(freshSnapshot, mode);
  if (!freshGate.ready) {
    throw new Error(
      `final_gate_blocked:${(freshGate.blockers || freshGate.unknowns || []).join(",") || "unknown"}`,
    );
  }
  const observedBoundary = assertSameMergeBoundary(approvedBoundary, freshSnapshot);
  const observedReviewEvidence = assertSameMergeReviewEvidence(
    approvedReviewEvidence,
    freshSnapshot,
  );
  return {
    gate: freshGate,
    boundary: observedBoundary,
    reviewEvidence: observedReviewEvidence,
  };
}

function receiptSummary(entry) {
  if (entry.error) {
    return {
      name: entry.name,
      action: entry.name === "post_merge_thanks" ? "post_comment" : null,
      status: "failed_after_merge",
      outcome: null,
      error: entry.error,
    };
  }
  const receipt = entry.receipt;
  return {
    name: entry.name,
    action: receipt?.action || null,
    status: receipt?.status || null,
    outcome: receipt?.outcome ?? null,
    observedHead: receipt?.observedHead ?? null,
    verification: receipt?.verification ?? null,
    authority: receipt?.authority ?? null,
    redemption: receipt?.redemption ?? null,
  };
}

async function reconcileAlreadyMerged({ args, mode, snapshot }) {
  const pr = snapshot.evidence?.pullRequest || {};
  const expectedHead = snapshot.headOid;
  const authorLogin = pr.author?.login || null;
  const thankBody =
    args.thankComment ||
    (authorLogin && !args.skipThanks ? defaultThanksBody({ author: authorLogin }) : null);
  const thankRequest = thankBody
    ? buildThankRequest({ repo: args.repo, pr: args.pr, expectedHead, body: thankBody })
    : null;
  const plan = thankRequest ? planMutationWithAuthority(thankRequest) : null;
  const summary = {
    schemaVersion: 1,
    kind: "github-delivery/merge-pr-driver",
    repo: args.repo,
    pr: args.pr,
    mode,
    headOid: expectedHead,
    alreadyMerged: true,
    recovery: "post_merge_reconciliation",
    steps: plan
      ? [{ name: "post_merge_thanks", action: plan.action, command: plan.command, requestHash: plan.requestHash, authority: plan.authority }]
      : [],
    executed: false,
  };
  if (!args.execute || !thankRequest) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const fresh = captureLiveSnapshot({ repo: args.repo, pr: args.pr });
  if (fresh.headOid !== expectedHead || fresh.evidence?.pullRequest?.state !== "MERGED") {
    throw new Error("post_merge_reconciliation_state_moved");
  }
  const authorized = authorizeMergeRequests([{ name: "post_merge_thanks", request: thankRequest }]);
  const request = authorized.requests[0]?.request;
  if (!request) throw new Error("authorized_post_merge_thanks_missing");
  const receipt = executeMutationWithAuthority({ request, execute: true });
  if (args.audit) appendFileSync(args.audit, `${JSON.stringify(receipt)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    ...summary,
    executed: true,
    authorityBatch: { batchId: authorized.batchId, expiresAt: authorized.expiresAt },
    receipts: [receiptSummary({ name: "post_merge_thanks", receipt })],
  }, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = normalizeMutationMode(args.mode);
  if (!mutationProfile(mode).actions.merge_pr?.allowed) {
    throw new Error(`mutation_mode_merge_forbidden:${mode}`);
  }
  if (args.execute && !args.settle) {
    throw new Error("merge_execute_requires_settle");
  }

  let snapshot = captureLiveSnapshot({ repo: args.repo, pr: args.pr });
  if (args.expectedHead && snapshot.headOid !== String(args.expectedHead).toLowerCase()) {
    throw new Error(
      `expected_head_mismatch: expected ${args.expectedHead}, observed ${snapshot.headOid}`,
    );
  }
  let pr = snapshot.evidence?.pullRequest || {};
  if (pr.state === "MERGED") {
    await reconcileAlreadyMerged({ args, mode, snapshot });
    return;
  }
  if (pr.isDraft === true) throw new Error("pr_is_draft");

  let gate = buildGateOutput(snapshot, mode);
  if (!gate.ready) {
    throw new Error(`gate_blocked:${(gate.blockers || gate.unknowns || []).join(",") || "unknown"}`);
  }

  if (args.settle) {
    const settled = await settle({ repo: args.repo, pr: args.pr, mode, snapshot });
    if (!settled.ok) throw new Error(`settle_failed:${settled.reason}`);
    snapshot = settled.snapshot;
    gate = settled.gate;
    pr = snapshot.evidence?.pullRequest || pr;
  }

  const approvedBoundary = mergeBoundaryForSnapshot(snapshot);
  const approvedReviewEvidence = mergeReviewEvidenceForSnapshot(snapshot);
  const expectedHead = snapshot.headOid;
  const mergeMethod = args.mergeMethod || detectMergeMethod(readRepositoryMergeCapabilities(args.repo));
  const authorLogin = pr.author?.login || null;
  const thankBody =
    args.thankComment ||
    (authorLogin && !args.skipThanks ? defaultThanksBody({ author: authorLogin }) : null);

  const mergeRequest = buildMergeRequest({
    repo: args.repo,
    pr: args.pr,
    expectedHead,
    mergeMethod,
  });
  const thankRequest = thankBody
    ? buildThankRequest({ repo: args.repo, pr: args.pr, expectedHead, body: thankBody })
    : null;
  const requests = [
    { name: "merge", request: mergeRequest },
    ...(thankRequest ? [{ name: "post_merge_thanks", request: thankRequest }] : []),
  ];
  const plans = requests.map(({ name, request }) => ({
    name,
    plan: planMutationWithAuthority(request),
  }));

  const summary = {
    schemaVersion: 1,
    kind: "github-delivery/merge-pr-driver",
    repo: args.repo,
    pr: args.pr,
    mode,
    headOid: expectedHead,
    mergeBoundary: approvedBoundary,
    reviewEvidence: approvedReviewEvidence,
    gate: {
      decision: gate.decision,
      ready: gate.ready,
      blockers: gate.blockers,
      unknowns: gate.unknowns,
    },
    settle: args.settle,
    mergeMethod,
    author: authorLogin,
    steps: plans.map(({ name, plan }) => ({
      name,
      action: plan.action,
      command: plan.command,
      requestHash: plan.requestHash,
      authority: plan.authority,
    })),
    executed: false,
  };

  if (!args.execute) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  // Verify all gate-critical state before requesting destructive authority.
  const freshSnapshot = captureLiveSnapshot({ repo: args.repo, pr: args.pr });
  const finalBoundary = verifyFinalMergeBoundary({
    approvedBoundary,
    approvedReviewEvidence,
    freshSnapshot,
    mode,
  });

  // Authorize the exact batch only after the first final-boundary recapture.
  // The transaction performs one more live boundary check immediately before
  // the merge write, after any human approval delay.
  const authorizedBatch = authorizeMergeRequests(requests);
  const authorizedMergeRequest = authorizedBatch.requests.find(
    (entry) => entry.name === "merge",
  )?.request;
  const authorizedThankRequest = authorizedBatch.requests.find(
    (entry) => entry.name === "post_merge_thanks",
  )?.request || null;
  if (!authorizedMergeRequest) throw new Error("authorized_merge_request_missing");

  let immediateBoundary = null;
  const receipts = executeMergeTransaction({
    mergeRequest: authorizedMergeRequest,
    thankRequest: authorizedThankRequest,
    beforeMerge() {
      const immediateSnapshot = captureLiveSnapshot({ repo: args.repo, pr: args.pr });
      immediateBoundary = verifyFinalMergeBoundary({
        approvedBoundary,
        approvedReviewEvidence,
        freshSnapshot: immediateSnapshot,
        mode,
      });
    },
    executeRequest(request) {
      const receipt = executeMutationWithAuthority({ request, execute: true });
      if (args.audit) appendFileSync(args.audit, `${JSON.stringify(receipt)}\n`, "utf8");
      return receipt;
    },
  });

  const merged = receipts.find((item) => item.name === "merge")?.receipt;
  if (!isFinalMergeOutcome(merged)) {
    throw new Error(
      `merge_not_final:${merged?.outcome || merged?.status || "unknown"}`,
    );
  }
  const cleanup = evaluateHeadBranchCleanup({
    actorLogin: process.env.GH_ACTOR_LOGIN || null,
    headOwnerLogin: null,
    headRefName: null,
    isMerged: isFinalMergeOutcome(merged),
  });

  const final = {
    ...summary,
    executed: true,
    partialFailure: receipts.some((entry) => Boolean(entry.error)),
    authorityBatch: {
      batchId: authorizedBatch.batchId,
      expiresAt: authorizedBatch.expiresAt,
    },
    finalBoundary,
    immediateBoundary,
    receipts: receipts.map(receiptSummary),
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
