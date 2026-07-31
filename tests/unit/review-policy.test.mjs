import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReviewPolicy,
  maxRequiredApprovalCount,
  parseReviewThreadArgs,
  reduceEffectiveReviews,
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
  assert.deepEqual(parseReviewThreadArgs(["Wibias/shipping-github", "42"]), {
    repo: "Wibias/shipping-github",
    pr: 42,
    resolveId: null,
  });
});

test("review-threads resolve mode parses the thread ID", () => {
  assert.deepEqual(
    parseReviewThreadArgs([
      "Wibias/shipping-github",
      "42",
      "--resolve",
      "PRRT_example",
    ]),
    {
      repo: "Wibias/shipping-github",
      pr: 42,
      resolveId: "PRRT_example",
    },
  );
});

test("review-threads rejects a missing resolve value", () => {
  assert.throws(
    () => parseReviewThreadArgs(["Wibias/shipping-github", "42", "--resolve"]),
    /requires a review thread ID/,
  );
});

test("a later approval supersedes the same reviewer's change request", () => {
  const effective = reduceEffectiveReviews([
    review("alice", "CHANGES_REQUESTED", "2026-07-31T10:00:00Z", "old"),
    review("alice", "APPROVED", "2026-07-31T11:00:00Z", "head"),
  ]);

  assert.equal(effective.length, 1);
  assert.equal(effective[0].state, "APPROVED");
});

test("a comment does not erase an existing approval", () => {
  const effective = reduceEffectiveReviews([
    review("alice", "APPROVED", "2026-07-31T10:00:00Z"),
    review("alice", "COMMENTED", "2026-07-31T11:00:00Z"),
  ]);

  assert.equal(effective.length, 1);
  assert.equal(effective[0].state, "APPROVED");
});

test("a dismissed review clears that reviewer's prior decision", () => {
  const effective = reduceEffectiveReviews([
    review("alice", "APPROVED", "2026-07-31T10:00:00Z"),
    review("alice", "DISMISSED", "2026-07-31T11:00:00Z"),
  ]);

  assert.deepEqual(effective, []);
});

test("ordinary required approval counts block when approvals are missing", () => {
  const result = evaluateReviewPolicy({
    reviewDecision: "REVIEW_REQUIRED",
    requiresApprovingReviews: true,
    requiredApprovalCount: 2,
    reviews: [review("alice", "APPROVED", "2026-07-31T10:00:00Z")],
  });

  assert.ok(result.blockers.includes("review_required"));
  assert.ok(result.blockers.includes("required_approvals_missing"));
});

test("conversation resolution policy requests the thread check without blocking by itself", () => {
  const result = evaluateReviewPolicy({
    reviewDecision: "APPROVED",
    requiresConversationResolution: true,
    reviews: [review("alice", "APPROVED", "2026-07-31T10:00:00Z")],
  });

  assert.equal(result.conversationResolutionCheckRequired, true);
  assert.deepEqual(result.blockers, []);
});

test("last-push approval relies on GitHub's current review decision", () => {
  const blocked = evaluateReviewPolicy({
    reviewDecision: "REVIEW_REQUIRED",
    requireLastPushApproval: true,
    reviews: [review("alice", "APPROVED", "2026-07-31T10:00:00Z", "old")],
  });
  assert.ok(blocked.blockers.includes("last_push_approval_needed"));

  const clear = evaluateReviewPolicy({
    reviewDecision: "APPROVED",
    requireLastPushApproval: true,
    reviews: [review("alice", "APPROVED", "2026-07-31T11:00:00Z", "head")],
  });
  assert.deepEqual(clear.blockers, []);
});

test("required approval count uses the strictest active source", () => {
  assert.equal(
    maxRequiredApprovalCount({
      matchingRules: [{ requiredApprovingReviewCount: 1 }],
      restProtection: { requiredApprovingReviewCount: 2 },
      rulesetPullRequest: [{ required_approving_review_count: 3 }],
    }),
    3,
  );
});
