import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRequiredCheckCompleteness,
  evaluateRequiredChecks,
  latestLiveChecks,
  normalizeRequiredChecks,
} from "../../scripts/lib/required-checks-policy.mjs";

function run(name, appId, conclusion, overrides = {}) {
  return {
    id: overrides.id || 1,
    name,
    status: overrides.status || "completed",
    conclusion,
    completed_at: overrides.completed_at || "2026-08-01T00:00:00Z",
    app: { id: appId, slug: `app-${appId}` },
  };
}

function status(context, state, createdAt = "2026-08-01T00:00:00Z") {
  return { context, state, created_at: createdAt, creator: { login: "ci" } };
}

test("preserves app-bound required checks", () => {
  const policy = normalizeRequiredChecks({
    classicRequiredStatusChecks: {
      checks: [
        { context: "build", app_id: 11 },
        { context: "build", app_id: 22 },
      ],
    },
  });
  assert.deepEqual(
    policy.descriptors.map(({ context, appId }) => ({ context, appId })),
    [
      { context: "build", appId: 11 },
      { context: "build", appId: 22 },
    ],
  );
});

test("ruleset integration_id is preserved", () => {
  const policy = normalizeRequiredChecks({
    activeRules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "lint", integration_id: 77 }],
        },
      },
    ],
  });
  assert.equal(policy.descriptors[0].appId, 77);
});

test("an app-bound requirement cannot be satisfied by another app", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: ["classic_check"] }],
    checkRuns: [run("build", 22, "success")],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.requiredStatus[0].gate, "missing");
});

test("unbound duplicate producers fail when any producer fails", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: null, sources: ["classic_context"] }],
    checkRuns: [run("build", 11, "success"), run("build", 22, "failure")],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.requiredStatus[0].ambiguous, true);
  assert.equal(result.requiredStatus[0].gate, "fail");
});

test("latest check run per app wins over an older rerun", () => {
  const live = latestLiveChecks({
    checkRuns: [
      run("build", 11, "failure", {
        completed_at: "2026-08-01T00:00:00Z",
        id: 1,
      }),
      run("build", 11, "success", {
        completed_at: "2026-08-01T01:00:00Z",
        id: 2,
      }),
    ],
  });
  assert.equal(live.length, 1);
  assert.equal(live[0].gate, "pass");
});

test("latest commit status per context wins", () => {
  const live = latestLiveChecks({
    statuses: [
      status("legacy", "failure", "2026-08-01T00:00:00Z"),
      status("legacy", "success", "2026-08-01T01:00:00Z"),
    ],
  });
  assert.equal(live.length, 1);
  assert.equal(live[0].gate, "pass");
});

test("pending required checks block", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, null, { status: "in_progress" })],
  });
  assert.equal(result.decision, "blocked");
  assert.match(result.blockers[0], /^pending:/);
});

test("unknown check conclusions produce unknown, never ready", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, "mystery")],
  });
  assert.equal(result.decision, "unknown");
});

test("incomplete policy or live evidence fails closed", () => {
  const completeness = evaluateRequiredCheckCompleteness({
    branchProtectionGraphqlComplete: true,
    matchingClassicRuleCount: 0,
    classicProtectionReadable: false,
    activeRulesComplete: false,
    checkRunsComplete: true,
    statusesComplete: true,
  });
  const result = evaluateRequiredChecks({
    evidenceComplete: completeness.complete,
    incompleteReasons: completeness.reasons,
  });
  assert.equal(result.decision, "unknown");
  assert.ok(result.unknowns.includes("active_rules_incomplete"));
});

test("strict required checks block an out-of-date branch", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, "success")],
    strict: true,
    mergeStateStatus: "BEHIND",
  });
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("strict_branch_out_of_date"));
});

test("observed mode blocks visible failing checks without inventing names", () => {
  const result = evaluateRequiredChecks({
    descriptors: [],
    checkRuns: [run("optional-but-failing", 11, "failure")],
  });
  assert.equal(result.mode, "observed");
  assert.equal(result.decision, "blocked");
});

test("classic checks supersede the deprecated mirrored contexts list", () => {
  const policy = normalizeRequiredChecks({
    classicRequiredStatusChecks: {
      contexts: ["build"],
      checks: [{ context: "build", app_id: 11 }],
    },
  });
  assert.deepEqual(
    policy.descriptors.map(({ context, appId }) => ({ context, appId })),
    [{ context: "build", appId: 11 }],
  );
});

test("app id -1 explicitly allows any source", () => {
  const policy = normalizeRequiredChecks({
    classicRequiredStatusChecks: {
      checks: [{ context: "build", app_id: -1 }],
    },
  });
  assert.equal(policy.descriptors[0].appId, null);
});

test("an app-bound commit status with unverifiable source stays unknown", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "legacy", appId: 11, sources: [] }],
    statuses: [status("legacy", "success")],
  });
  assert.equal(result.decision, "unknown");
  assert.equal(result.requiredStatus[0].sourceIdentityUnverifiable, true);
});

test("known failures stay blocked when another source is incomplete", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, "failure")],
    evidenceComplete: false,
    incompleteReasons: ["active_rules_incomplete"],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.complete, false);
});
