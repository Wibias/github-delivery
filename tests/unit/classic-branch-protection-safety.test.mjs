import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRequiredChecksSnapshot,
  evaluateReviewPolicySnapshot,
  patternMatchesBranch,
} from "../../scripts/lib/snapshot-evaluators.mjs";

function completeSource() {
  return { required: true, readable: true, complete: true, error: null };
}

function snapshot({ pattern = "ma?n", branchProtection = null } = {}) {
  return {
    snapshotId: "snap",
    repo: "acme/widgets",
    pr: 42,
    headOid: "a".repeat(40),
    sources: {
      policyGraphql: completeSource(),
      branchProtection: completeSource(),
      activeRules: completeSource(),
      checkRuns: completeSource(),
      statuses: completeSource(),
    },
    evidence: {
      pullRequest: {
        baseRefName: "main",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        isDraft: false,
        reviewDecision: "APPROVED",
        url: "https://github.com/acme/widgets/pull/42",
      },
      branchProtection,
      activeRules: [],
      checks: { checkRuns: [], statuses: [] },
      policy: {
        branchProtectionRules: {
          pageInfo: { hasNextPage: false },
          nodes: pattern ? [{ pattern }] : [],
        },
        latestOpinionatedReviews: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        mergeQueue: { enabled: false, inQueue: false, entry: null },
      },
    },
  };
}

test("classic branch patterns follow GitHub pathname-style wildcard semantics", () => {
  for (const [pattern, branch, expected] of [
    ["ma?n", "main", true],
    ["release/[12].x", "release/1.x", true],
    ["release/[!3].x", "release/2.x", true],
    ["release/[!3].x", "release/3.x", false],
    ["release/*", "release/1.x", true],
    ["release/*", "release/1/x", false],
    ["release/**", "release/1/x", true],
    ["literal\\?branch", "literal?branch", false],
  ]) {
    assert.equal(patternMatchesBranch(pattern, branch), expected, `${pattern} -> ${branch}`);
  }
});

test("matching classic protection plus a 404-like null payload is unknown for checks", () => {
  const result = evaluateRequiredChecksSnapshot(snapshot());
  assert.equal(result.decision, "unknown");
  assert.ok(result.unknowns.includes("effective_classic_protection_unreadable"));
});

test("matching classic protection plus a 404-like null payload is unknown for reviews", () => {
  const result = evaluateReviewPolicySnapshot(snapshot());
  assert.equal(result.decision, "unknown");
  assert.ok(result.unknowns.includes("effective_classic_protection_unreadable"));
});

test("an unprotected branch with no matching classic rule is not blocked by a null payload", () => {
  const checks = evaluateRequiredChecksSnapshot(snapshot({ pattern: null }));
  const reviews = evaluateReviewPolicySnapshot(snapshot({ pattern: null }));
  assert.equal(checks.decision, "ready");
  assert.equal(reviews.decision, "ready");
});