import assert from "node:assert/strict";
import test from "node:test";

import { planVerificationMethods } from "../../scripts/lib/verification-method-routing.mjs";

function plan(overrides = {}) {
  return {
    bugReview: { depth: "targeted", requiredLenses: [] },
    securityReview: { depth: "targeted", requiredDomains: [] },
    requiredProbes: [],
    bugLenses: [],
    domains: [],
    ...overrides,
  };
}

test("malformed and parsing surfaces route to property and fuzz verification", () => {
  const result = planVerificationMethods(plan({
    bugReview: { depth: "deep", requiredLenses: ["parsing_serialization", "boundary_conditions"] },
    requiredProbes: ["malformed-input-robustness"],
  }));

  assert.ok(result.requiredMethods.includes("property-based"));
  assert.ok(result.requiredMethods.includes("fuzz"));
  assert.ok(result.reasons["property-based"].some((reason) => reason.includes("parsing_serialization")));
});

test("state, retry, and concurrency surfaces route to invariant/state-machine verification", () => {
  const result = planVerificationMethods(plan({
    bugReview: { depth: "deep", requiredLenses: ["concurrency_races", "retry_idempotency", "state_consistency"] },
  }));

  assert.ok(result.requiredMethods.includes("invariant"));
  assert.ok(result.requiredMethods.includes("state-machine"));
  assert.ok(result.requiredMethods.includes("fault-injection"));
});

test("recursion probe routes to bounded generative termination checks", () => {
  const result = planVerificationMethods(plan({
    bugReview: { depth: "deep", requiredLenses: ["edge_cases"] },
    requiredProbes: ["recursion-termination"],
  }));

  assert.ok(result.requiredMethods.includes("property-based"));
  assert.ok(result.requiredMethods.includes("bounded-generative"));
});

test("targeted depth recommends executable methods while deep/full makes them required when feasible", () => {
  const targeted = planVerificationMethods(plan({
    bugReview: { depth: "targeted", requiredLenses: ["parsing_serialization"] },
  }));
  const deep = planVerificationMethods(plan({
    bugReview: { depth: "deep", requiredLenses: ["parsing_serialization"] },
  }));

  assert.deepEqual(targeted.requiredMethods, []);
  assert.ok(targeted.recommendedMethods.includes("property-based"));
  assert.ok(deep.requiredMethods.includes("property-based"));
});

test("security business logic and authz route to invariant verification without authorizing red team", () => {
  const result = planVerificationMethods(plan({
    securityReview: { depth: "full", requiredDomains: ["authz", "business_logic"] },
  }));

  assert.ok(result.requiredMethods.includes("invariant"));
  assert.equal(result.requiredMethods.includes("red-team"), false);
  assert.equal(result.recommendedMethods.includes("red-team"), false);
  assert.equal(result.adversarialAuthorized, false);
});

test("baseline review does not manufacture expensive verification obligations", () => {
  const result = planVerificationMethods(plan({
    bugReview: { depth: "baseline", requiredLenses: [] },
    securityReview: { depth: "baseline", requiredDomains: [] },
  }));

  assert.deepEqual(result.requiredMethods, []);
  assert.deepEqual(result.recommendedMethods, []);
});
