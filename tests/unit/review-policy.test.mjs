import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePolicyDataCompleteness,
  evaluateReviewPolicy,
  maxRequiredApprovalCount,
  parseReviewThreadArgs,
  summarizeLatestOpinionatedReviews,
} from "../../scripts/lib/review-policy.mjs";

function review(login, state, submittedAt, commit = "head") {
  return {
    author: { login },
    state,
    submittedAt,
    commit: { oid: commit },
  };
}

test("review-threads read mode preserves OWNER/REPO", () => {
  assert.deepEqual(parseReviewThreadArgs(["Wibias/github-delivery", "42"]), {
    repo: "Wibias/github-delivery",
    pr: 42,
    resolveId: null,
  });
});

test("review-threads resolve mode parses the thread ID", () => {
  assert.deepEqual(
    parseReviewThreadArgs([
      "Wibias/github-delivery",
      "42",
      "--resolve",
      "PRRT_example",
    ]),
    {
      repo: "Wibias/github-delivery",
      pr: 42,
      resolveId: "PRRT_example",
    },
  );
});

test("review-threads rejects a missing resolve value", () => {
  assert.throws(
    () => parseReviewThreadArgs(["Wibias/github-delivery", "42", "--resolve"]),
    /requires a review thread ID/,
  );
});

test("latest opinionated reviews are summarized without replaying history", () => {
  const summary = summarizeLatestOpinionatedReviews([
    review("alice", "APPROVED", "2026-07-31T11:00:00Z"),
    review("bob", "CHANGES_REQUESTED", "2026-07-31T12:00:00Z"),
    review("carol", "DISMISSED", "2026-07-31T13:00:00Z"),
  ]);

  assert.deepEqual(
    summary.approvals.map((item) => item.author.login),
    ["alice"],
  );
  assert.deepEqual(
    summary.changesRequested.map((item) => item.author.login),
    ["bob"],
  );
});

test("GitHub reviewDecision stays authoritative over diagnostic review rows", () => {
  const result = evaluateReviewPolicy({
    reviewDecision: "APPROVED",
    requiresApprovingReviews: true,
    requiredApprovalCount: 1,
    latestOpinionatedReviews: [
      review("alice", "CHANGES_REQUESTED", "2026-07-31T10:00:00Z"),
    ],
  });

  assert.deepEqual(result.blockers, []);
  assert.equal(result.changesRequested.length, 1);
});

test("ordinary required approvals block through GitHub reviewDecision", () => {
  const result = evaluateReviewPolicy({
    reviewDecision: "REVIEW_REQUIRED",
    requiresApprovingReviews: true,
    requiredApprovalCount: 2,
    latestOpinionatedReviews: [
      review("alice", "APPROVED", "2026-07-31T10:00:00Z"),
    ],
  });

  assert.ok(result.blockers.includes("review_required"));
  assert.ok(result.blockers.includes("required_approvals_missing"));
});

test("conversation resolution requests a thread check without blocking itself", () => {
  const result = evaluateReviewPolicy({
    reviewDecision: "APPROVED",
    requiresConversationResolution: true,
    latestOpinionatedReviews: [
      review("alice", "APPROVED", "2026-07-31T10:00:00Z"),
    ],
  });

  assert.equal(result.conversationResolutionCheckRequired, true);
  assert.deepEqual(result.blockers, []);
});

test("last-push approval relies on GitHub's current review decision", () => {
  const blocked = evaluateReviewPolicy({
    reviewDecision: "REVIEW_REQUIRED",
    requireLastPushApproval: true,
    latestOpinionatedReviews: [
      review("alice", "APPROVED", "2026-07-31T10:00:00Z", "old"),
    ],
  });
  assert.ok(blocked.blockers.includes("last_push_approval_needed"));

  const clear = evaluateReviewPolicy({
    reviewDecision: "APPROVED",
    requireLastPushApproval: true,
    latestOpinionatedReviews: [
      review("alice", "APPROVED", "2026-07-31T11:00:00Z", "head"),
    ],
  });
  assert.deepEqual(clear.blockers, []);
});

test("classic branch patterns are not combined as cumulative policy", () => {
  assert.equal(
    maxRequiredApprovalCount({
      matchingRules: [
        { pattern: "main", requiredApprovingReviewCount: 1 },
        { pattern: "*", requiredApprovingReviewCount: 3 },
      ],
      restProtection: { requiredApprovingReviewCount: 1 },
      activePullRequestRules: [],
    }),
    1,
  );
});

test("active rulesets remain cumulative with the effective classic rule", () => {
  assert.equal(
    maxRequiredApprovalCount({
      restProtection: { requiredApprovingReviewCount: 1 },
      activePullRequestRules: [
        { required_approving_review_count: 2 },
        { required_approving_review_count: 3 },
      ],
    }),
    3,
  );
});

test("unreadable active rules fail policy completeness closed", () => {
  const result = evaluatePolicyDataCompleteness({
    branchProtectionGraphqlComplete: true,
    matchingClassicRuleCount: 0,
    classicProtectionReadable: false,
    activeRulesComplete: false,
  });

  assert.equal(result.complete, false);
  assert.ok(result.reasons.includes("active_rules_incomplete"));
});

test("an expected classic rule must have a readable effective response", () => {
  const result = evaluatePolicyDataCompleteness({
    branchProtectionGraphqlComplete: true,
    matchingClassicRuleCount: 2,
    classicProtectionReadable: false,
    activeRulesComplete: true,
  });

  assert.equal(result.complete, false);
  assert.ok(
    result.reasons.includes("effective_classic_protection_unreadable"),
  );
});

test("no classic match does not require a readable classic response", () => {
  const result = evaluatePolicyDataCompleteness({
    branchProtectionGraphqlComplete: true,
    matchingClassicRuleCount: 0,
    classicProtectionReadable: false,
    activeRulesComplete: true,
  });

  assert.deepEqual(result, { complete: true, reasons: [] });
});

test("truncated classic rule diagnostics fail closed", () => {
  const result = evaluatePolicyDataCompleteness({
    branchProtectionGraphqlComplete: false,
    matchingClassicRuleCount: 0,
    classicProtectionReadable: false,
    activeRulesComplete: true,
  });

  assert.equal(result.complete, false);
  assert.ok(result.reasons.includes("classic_branch_rules_incomplete"));
});

test("missing reviewDecision fails closed when reviews are required", () => {
  const result = evaluateReviewPolicy({
    reviewDecision: null,
    requiresApprovingReviews: true,
    requiredApprovalCount: 1,
  });

  assert.ok(result.blockers.includes("review_decision_unknown"));
});

test("unknown future reviewDecision fails closed instead of becoming implicitly approved", () => {
  const result = evaluateReviewPolicy({
    reviewDecision: "FUTURE_GITHUB_REVIEW_STATE",
    requiresApprovingReviews: true,
    requiredApprovalCount: 1,
  });

  assert.ok(result.blockers.includes("review_decision_unknown"));
});
