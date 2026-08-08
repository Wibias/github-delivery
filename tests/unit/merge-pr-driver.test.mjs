import assert from "node:assert/strict";
import test from "node:test";

import { planMutationRequest } from "../../scripts/lib/github-mutation-broker.mjs";
import {
  buildGateOutput,
  buildMergeRequest,
  buildThankRequest,
  defaultThanksBody,
  detectMergeMethod,
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

test("merge driver buildThankRequest produces an idempotent post_comment plan", () => {
  const request = buildThankRequest({
    repo: "acme/widget",
    pr: 42,
    expectedHead: HEAD,
    body: "Thanks @alice - merging.",
  });
  const plan = planMutationRequest(request);
  assert.equal(plan.action, "post_comment");
  assert.equal(plan.idempotencyKey, "merge-thanks-pr-42");
  assert.equal(plan.expectedHead, HEAD);
  assert.deepEqual(plan.command.slice(0, 3), ["gh", "pr", "comment"]);
  assert.ok(plan.command.includes("Thanks @alice - merging."));
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

test("merge driver defaults to merge commits and builds a thanks body", () => {
  assert.equal(detectMergeMethod(), "merge");
  const body = defaultThanksBody({ author: "alice", repo: "acme/widget", pr: 42, title: "Test PR" });
  assert.match(body, /@alice/);
  assert.match(body, /merging/);
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
