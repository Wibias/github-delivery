import assert from "node:assert/strict";
import test from "node:test";

import { combineShipGateResults } from "../../scripts/lib/ship-gate-policy.mjs";

function component(decision = "ready", overrides = {}) {
  return {
    decision,
    complete: decision !== "unknown",
    blockers: [],
    unknowns: [],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    snapshot: {
      snapshotId: "snap-42",
      repo: "Wibias/shipping-github",
      pr: 42,
      headOid: "abc123",
      evidence: {
        pullRequest: {
          url: "https://github.com/Wibias/shipping-github/pull/42",
        },
      },
    },
    requiredChecks: component(),
    reviewPolicy: component(),
    reviewThreads: component(),
    wake: component(),
    codeowners: {
      decision: "ready",
      complete: true,
      authority: "advisory",
      ownersUnion: ["@maintainers"],
      codeownersErrors: [],
    },
    ...overrides,
  };
}

test("returns ready only when every authoritative component is ready", () => {
  const result = combineShipGateResults(input());
  assert.equal(result.decision, "ready");
  assert.equal(result.complete, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
});

test("known blockers take precedence over unknown evidence", () => {
  const result = combineShipGateResults(
    input({
      requiredChecks: component("unknown", {
        complete: false,
        unknowns: ["check_runs_incomplete"],
      }),
      reviewThreads: component("blocked", {
        blockers: ["unresolved_review_threads"],
      }),
    }),
  );
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("reviewThreads:unresolved_review_threads"));
  assert.ok(result.unknowns.includes("requiredChecks:check_runs_incomplete"));
});

test("returns unknown when evidence is incomplete and no blocker is known", () => {
  const result = combineShipGateResults(
    input({
      wake: component("unknown", {
        complete: false,
        unknowns: ["feedback_data_incomplete"],
      }),
    }),
  );
  assert.equal(result.decision, "unknown");
  assert.equal(result.complete, false);
  assert.ok(result.unknowns.includes("wake:feedback_data_incomplete"));
});

test("CODEOWNERS remains advisory and cannot block or make the final decision unknown", () => {
  const result = combineShipGateResults(
    input({
      codeowners: {
        decision: "unknown",
        complete: false,
        authority: "advisory",
        ownersUnion: [],
        codeownersErrors: [{ line: 1, message: "invalid pattern" }],
        unknowns: ["codeowners_evidence_incomplete"],
      },
    }),
  );
  assert.equal(result.decision, "ready");
  assert.ok(result.advisories.some((item) => item.code === "codeowners_incomplete"));
  assert.ok(result.advisories.some((item) => item.code === "codeowners_parse_errors"));
});

test("namespaces structured wake blockers by stable key", () => {
  const result = combineShipGateResults(
    input({
      wake: component("blocked", {
        blockers: [
          {
            key: "review_comment:77",
            reason: "trusted_human_feedback_needs_code",
          },
        ],
      }),
    }),
  );
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.blockers, [
    "wake:trusted_human_feedback_needs_code:review_comment:77",
  ]);
});
