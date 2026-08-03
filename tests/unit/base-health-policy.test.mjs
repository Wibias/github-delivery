import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBaseHealthSnapshot } from "../../scripts/lib/base-health-policy.mjs";

function run(name, conclusion) {
  return {
    id: `${name}-${conclusion}`,
    name,
    status: "completed",
    conclusion,
    app: { id: 10 },
    completed_at: "2026-08-01T00:00:00Z",
  };
}

function snapshot({ head = [], base = [], baseComplete = true } = {}) {
  return {
    snapshotId: "snap",
    repo: "Wibias/github-delivery",
    pr: 9,
    headOid: "head",
    sources: {
      baseRef: { complete: baseComplete },
      baseCheckRuns: { complete: baseComplete },
      baseStatuses: { complete: baseComplete },
    },
    evidence: {
      checks: { checkRuns: head, statuses: [] },
      baseHealth: {
        baseOid: baseComplete ? "base" : null,
        checks: { checkRuns: base, statuses: [] },
      },
    },
  };
}

test("classifies a failure shared with base without expanding PR scope", () => {
  const result = evaluateBaseHealthSnapshot(
    snapshot({
      head: [run("CI", "failure")],
      base: [run("CI", "failure")],
    }),
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.sharedFailures.length, 1);
  assert.equal(result.prOnlyFailures.length, 0);
  assert.equal(result.scopeRecommendation, "separate_follow_up");
});

test("classifies a head-only failure as PR scope", () => {
  const result = evaluateBaseHealthSnapshot(
    snapshot({
      head: [run("CI", "failure")],
      base: [run("CI", "success")],
    }),
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.prOnlyFailures.length, 1);
  assert.equal(result.scopeRecommendation, "fix_in_pr");
});

test("fails unknown when a red head cannot be compared to base", () => {
  const result = evaluateBaseHealthSnapshot(
    snapshot({ head: [run("CI", "failure")], baseComplete: false }),
  );
  assert.equal(result.decision, "unknown");
  assert.match(result.unknowns[0], /failure_origin_unknown/);
});

test("does not require base comparison for a green head", () => {
  const result = evaluateBaseHealthSnapshot(
    snapshot({ head: [run("CI", "success")], baseComplete: false }),
  );
  assert.equal(result.decision, "ready");
  assert.equal(result.comparisonRequired, false);
});

test("reports base-only failures without blocking a passing head", () => {
  const result = evaluateBaseHealthSnapshot(
    snapshot({
      head: [run("CI", "success")],
      base: [run("Other", "failure")],
    }),
  );
  assert.equal(result.decision, "ready");
  assert.equal(result.baseOnlyFailures.length, 1);
});
