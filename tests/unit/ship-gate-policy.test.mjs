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
      repo: "Wibias/github-delivery",
      pr: 42,
      headOid: "abc123",
      evidence: {
      pullRequest: {
        url: "https://github.com/Wibias/github-delivery/pull/42",
        mergeStateStatus: "CLEAN",
        stack: null,
      },
      },
    },
    requiredChecks: component(),
    baseHealth: component("ready", {
      baseOid: "base123",
      comparisonRequired: false,
      sharedFailures: [],
      prOnlyFailures: [],
      unknownFailures: [],
      baseOnlyFailures: [],
      scopeRecommendation: "none",
    }),
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

test("base health origin uncertainty prevents readiness", () => {
  const result = combineShipGateResults(
    input({
      baseHealth: component("unknown", {
        complete: false,
        unknowns: ["failure_origin_unknown:check_run\u0000CI\u000010"],
        sharedFailures: [],
        prOnlyFailures: [],
        unknownFailures: [{ context: "CI" }],
        baseOnlyFailures: [],
        scopeRecommendation: "investigate",
      }),
    }),
  );
  assert.equal(result.decision, "unknown");
  assert.ok(
    result.unknowns.some((item) => item.startsWith("baseHealth:failure_origin_unknown")),
  );
});

test("shared base failures stay blocked but produce separate-scope guidance", () => {
  const result = combineShipGateResults(
    input({
      baseHealth: component("blocked", {
        blockers: ["base_preexisting_failure:check_run\u0000CI\u000010"],
        sharedFailures: [{ context: "CI" }],
        prOnlyFailures: [],
        unknownFailures: [],
        baseOnlyFailures: [],
        scopeRecommendation: "separate_follow_up",
      }),
    }),
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.components.baseHealth.scopeRecommendation, "separate_follow_up");
  assert.ok(
    result.advisories.some((item) => item.code === "base_preexisting_failures"),
  );
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

test("merge queue stays unknown when required-check workflow mapping is unverified", () => {
  const result = combineShipGateResults(
    input({
      reviewPolicy: component("ready", {
        mergeQueue: { enabled: true, inQueue: false, entry: null },
        mergeGroupWorkflowCoverage: {
          complete: true,
          hasPullRequestTrigger: true,
          hasMergeGroupTrigger: true,
        },
      }),
    }),
  );
  assert.equal(result.decision, "unknown");
  assert.ok(
    result.unknowns.includes(
      "reviewPolicy:merge_group_required_check_mapping_unverified",
    ),
  );
});

test("merge queue can be ready after exact required-check workflow mapping is proven", () => {
  const result = combineShipGateResults(
    input({
      reviewPolicy: component("ready", {
        mergeQueue: { enabled: true, inQueue: false, entry: null },
        mergeGroupWorkflowCoverage: {
          complete: true,
          requiredCheckWorkflowMappingComplete: true,
        },
      }),
    }),
  );
  assert.equal(result.decision, "ready");
});
