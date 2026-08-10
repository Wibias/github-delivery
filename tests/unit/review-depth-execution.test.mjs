import assert from "node:assert/strict";
import test from "node:test";

import {
  planBugDepthExecution,
  planReviewDepthExecution,
  planSecurityDepthExecution,
} from "../../scripts/lib/review-depth-execution.mjs";

function bugScope(depth) {
  return { bugReviewDepth: depth };
}

function securityScope(depth) {
  return { securityReviewDepth: depth };
}

test("bug depth materially expands required execution", () => {
  const baseline = planBugDepthExecution(bugScope("baseline"));
  const targeted = planBugDepthExecution(bugScope("targeted"));
  const deep = planBugDepthExecution(bugScope("deep"));

  assert.ok(baseline.requiredStageIds.includes("bug-baseline-lenses"));
  assert.equal(baseline.requiredStageIds.includes("bug-candidate-validation"), false);
  assert.ok(targeted.requiredStageIds.includes("bug-candidate-validation"));
  assert.equal(targeted.requiredStageIds.includes("bug-finder-challenger-arbiter"), false);
  assert.ok(deep.requiredStageIds.includes("bug-finder-challenger-arbiter"));
  assert.ok(deep.requiredStageIds.includes("bug-high-risk-runtime-or-property-check"));
  assert.ok(deep.requiredStageIds.length > targeted.requiredStageIds.length);
  assert.ok(targeted.requiredStageIds.length > baseline.requiredStageIds.length);
});

test("security depth materially expands required execution without auto red team", () => {
  const baseline = planSecurityDepthExecution(securityScope("baseline"));
  const targeted = planSecurityDepthExecution(securityScope("targeted"));
  const full = planSecurityDepthExecution(securityScope("full"));

  assert.ok(baseline.requiredStageIds.includes("security-baseline-surfaces"));
  assert.ok(targeted.requiredStageIds.includes("security-source-sink-validation"));
  assert.ok(full.requiredStageIds.includes("security-independent-validation"));
  assert.ok(full.requiredStageIds.includes("security-attack-path-chain-analysis"));
  assert.ok(full.requiredStageIds.includes("security-variant-analysis"));
  assert.ok(full.forbiddenShortcuts.includes("auto-red-team-without-user-request"));
  assert.equal(full.requiredStageIds.some((id) => id.includes("red-team")), false);
});

test("skip depth has no execution stages", () => {
  assert.deepEqual(planBugDepthExecution(bugScope("skip")).requiredStageIds, []);
  assert.deepEqual(planSecurityDepthExecution(securityScope("skip")).requiredStageIds, []);
});

test("combined plan preserves both axis depths", () => {
  const plan = planReviewDepthExecution({
    bugScope: bugScope("deep"),
    securityScope: securityScope("targeted"),
  });
  assert.equal(plan.bug.depth, "deep");
  assert.equal(plan.security.depth, "targeted");
});

test("unknown depth fails closed", () => {
  assert.throws(() => planBugDepthExecution(bugScope("full")), /unknown bug review depth/);
  assert.throws(() => planSecurityDepthExecution(securityScope("deep")), /unknown security review depth/);
});
