import assert from "node:assert/strict";
import test from "node:test";

import { planMutationRequest } from "../../scripts/lib/github-mutation-broker.mjs";
import { executeMutationWithAuthority } from "../../scripts/lib/mutation-execution-context.mjs";
import {
  assertSameMergeBoundary,
  mergeBoundaryForSnapshot,
} from "../../scripts/lib/merge-boundary.mjs";
import {
  buildGateOutput,
  buildMergeRequest,
  buildThankRequest,
  defaultThanksBody,
  detectMergeMethod,
  executeMergeTransaction,
} from "../../scripts/merge-pr-driver.mjs";

const HEAD = "a93fc4ac8773de2533707c4a08ee8fc1fcec69de";

function readySnapshot({ state = "OPEN", isDraft = false, authorLogin = "alice" } = {}) {
  const complete = { required: true, readable: true, complete: true, error: null };
  return {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "merge-driver-test",
    repo: "acme/widget",
    pr: 42,
    headOid: HEAD,
    sources: {
      pr: complete,
      changedFiles: complete,
      activeRules: complete,
      checkRuns: complete,
      statuses: complete,
      issueComments: complete,
      reviewComments: complete,
      reviews: complete,
      reviewThreads: complete,
      branchProtection: complete,
      codeowners: complete,
      policyGraphql: complete,
      workflowCoverage: complete,
      viewer: complete,
    },
    evidence: {
      pullRequest: {
        url: "https://example.test/pr/42",
        headRefOid: HEAD,
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        commits: [],
        author: { login: authorLogin },
        title: "Test PR",
        isDraft,
        state,
        stack: null,
      },
      changedFiles: [],
      branchProtection: {},
      activeRules: [],
      checks: { checkRuns: [], statuses: [] },
      feedback: { issueComments: [], reviewComments: [], reviews: [], reviewThreads: [] },
      codeowners: {},
      policy: {},
      workflowCoverage: {},
      viewer: { login: "Wibias" },
    },
  };
}

function boundarySnapshot({
  baseOid = "b".repeat(40),
  rulesFingerprint = "c".repeat(64),
  strict = true,
  mergeQueue = false,
} = {}) {
  const snapshot = readySnapshot();
  snapshot.evidence.captureBoundary = {
    headOid: HEAD,
    baseRefName: "main",
    baseOid,
    rulesFingerprint,
  };
  snapshot.evidence.activeRules = strict
    ? [
        {
          type: "required_status_checks",
          parameters: { strict_required_status_checks_policy: true },
        },
      ]
    : [];
  snapshot.evidence.policy = { mergeQueue: { enabled: mergeQueue } };
  return snapshot;
}

test("merge driver gate is ready for a clean open PR", () => {
  const gate = buildGateOutput(readySnapshot(), "maintainer");
  assert.equal(gate.ready, true);
  assert.equal(gate.decision, "ready");
  assert.deepEqual(gate.blockers, []);
});

test("merge driver gate blocks on required-check pending", () => {
  const snapshot = readySnapshot();
  snapshot.evidence.checks.checkRuns = [
    { name: "CodeRabbit", status: "IN_PROGRESS", conclusion: null },
  ];
  snapshot.sources.checkRuns = { required: true, readable: true, complete: true, error: null };
  const gate = buildGateOutput(snapshot, "maintainer");
  assert.equal(gate.ready, false);
  assert.ok(gate.blockers.some((blocker) => blocker.includes("requiredChecks")));
});

test("merge boundary binds head, base oid, active rules, and feedback generation", () => {
  const boundary = mergeBoundaryForSnapshot(boundarySnapshot());
  assert.equal(boundary.headOid, HEAD);
  assert.equal(boundary.baseRefName, "main");
  assert.equal(boundary.baseOid, "b".repeat(40));
  assert.equal(boundary.rulesFingerprint, "c".repeat(64));
  assert.match(boundary.feedbackFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(boundary.coherence, "strict_required_checks");
});

test("merge boundary refuses repositories without server-enforced base coherence", () => {
  assert.throws(
    () => mergeBoundaryForSnapshot(boundarySnapshot({ strict: false, mergeQueue: false })),
    /merge_boundary_not_server_enforced/,
  );
});

test("merge boundary refuses direct merge while a native stack is present", () => {
  const snapshot = boundarySnapshot();
  snapshot.evidence.pullRequest = {
    ...snapshot.evidence.pullRequest,
    stack: { id: 427761, number: 289, position: 5, size: 5, baseRefName: "main" },
  };
  assert.throws(
    () => mergeBoundaryForSnapshot(snapshot),
    /merge_boundary_native_stack_unsupported/,
  );
});

test("merge boundary refuses merge when native stack identity was not captured", () => {
  const snapshot = boundarySnapshot();
  delete snapshot.evidence.pullRequest.stack;
  assert.throws(
    () => mergeBoundaryForSnapshot(snapshot),
    /merge_boundary_native_stack_unreadable/,
  );
});

test("merge boundary rejects a base move after approval", () => {
  const approved = mergeBoundaryForSnapshot(boundarySnapshot());
  const moved = boundarySnapshot({ baseOid: "d".repeat(40) });
  assert.throws(() => assertSameMergeBoundary(approved, moved), /merge_boundary_moved:baseOid/);
});

test("merge boundary rejects active-rules drift after approval", () => {
  const approved = mergeBoundaryForSnapshot(boundarySnapshot());
  const moved = boundarySnapshot({ rulesFingerprint: "e".repeat(64) });
  assert.throws(
    () => assertSameMergeBoundary(approved, moved),
    /merge_boundary_moved:rulesFingerprint/,
  );
});

test("merge driver buildThankRequest produces a remotely idempotent post_comment plan", () => {
  const visibleBody = "Thanks @alice - merged successfully.";
  const request = buildThankRequest({
    repo: "acme/widget",
    pr: 42,
    expectedHead: HEAD,
    body: visibleBody,
  });
  const plan = planMutationRequest(request);
  assert.equal(plan.action, "post_comment");
  assert.equal(plan.idempotencyKey, "merge-thanks-pr-42");
  assert.equal(plan.expectedHead, HEAD);
  assert.deepEqual(plan.command.slice(0, 3), ["gh", "pr", "comment"]);
  const bodyIndex = plan.command.indexOf("--body") + 1;
  assert.ok(bodyIndex > 0);
  assert.match(plan.command[bodyIndex], /^Thanks @alice - merged successfully\./);
  assert.match(
    plan.command[bodyIndex],
    /<!-- github-delivery:idempotency [0-9a-f]{64} -->$/,
  );
});

test("merge driver buildMergeRequest pins the head with --match-head-commit", () => {
  const request = buildMergeRequest({
    repo: "acme/widget",
    pr: 42,
    expectedHead: HEAD,
    mergeMethod: "merge",
  });
  const plan = planMutationRequest(request);
  assert.equal(plan.action, "merge_pr");
  assert.deepEqual(plan.command, [
    "gh",
    "pr",
    "merge",
    "42",
    "--repo",
    "acme/widget",
    "--merge",
    "--match-head-commit",
    HEAD,
  ]);
});

test("canonical merge execution fails closed when trusted authority is required", () => {
  const request = buildMergeRequest({
    repo: "acme/widget",
    pr: 42,
    expectedHead: HEAD,
    mergeMethod: "merge",
  });
  let spawned = false;
  assert.throws(
    () =>
      executeMutationWithAuthority({
        request,
        execute: true,
        env: { GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY: "1" },
        runner() {
          spawned = true;
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /trusted_authority_required/,
  );
  assert.equal(spawned, false);
});

test("merge driver defaults to merge commits and builds a post-merge thanks body", () => {
  assert.equal(detectMergeMethod(), "merge");
  const body = defaultThanksBody({ author: "alice", repo: "acme/widget", pr: 42, title: "Test PR" });
  assert.match(body, /@alice/);
  assert.match(body, /merged/i);
  assert.doesNotMatch(body, /merging this/i);
});

test("merge transaction executes the merge before the social thank-you", () => {
  const calls = [];
  const receipts = executeMergeTransaction({
    mergeRequest: { action: "merge_pr" },
    thankRequest: { action: "post_comment" },
    executeRequest(request) {
      calls.push(request.action);
      return {
        action: request.action,
        status: "succeeded",
        ...(request.action === "merge_pr" ? { outcome: "merged" } : {}),
      };
    },
  });
  assert.deepEqual(calls, ["merge_pr", "post_comment"]);
  assert.deepEqual(
    receipts.map((item) => item.name),
    ["merge", "post_merge_thanks"],
  );
});

test("merge transaction never posts thanks when the merge fails", () => {
  const calls = [];
  assert.throws(
    () =>
      executeMergeTransaction({
        mergeRequest: { action: "merge_pr" },
        thankRequest: { action: "post_comment" },
        executeRequest(request) {
          calls.push(request.action);
          if (request.action === "merge_pr") throw new Error("merge failed");
          return { action: request.action, status: "succeeded" };
        },
      }),
    /merge failed/,
  );
  assert.deepEqual(calls, ["merge_pr"]);
});

test("merge method detection follows squash-only repository capabilities", () => {
  assert.equal(
    detectMergeMethod({
      mergeCommitAllowed: false,
      squashMergeAllowed: true,
      rebaseMergeAllowed: false,
    }),
    "squash",
  );
});

test("merge method detection follows rebase-only repository capabilities", () => {
  assert.equal(
    detectMergeMethod({
      mergeCommitAllowed: false,
      squashMergeAllowed: false,
      rebaseMergeAllowed: true,
    }),
    "rebase",
  );
});

test("merge method detection fails closed when the repository exposes no merge method", () => {
  assert.throws(
    () =>
      detectMergeMethod({
        mergeCommitAllowed: false,
        squashMergeAllowed: false,
        rebaseMergeAllowed: false,
      }),
    /repository_has_no_enabled_merge_method/,
  );
});
