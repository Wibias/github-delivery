import assert from "node:assert/strict";
import test from "node:test";
import { evaluateBaseHealthSnapshot } from "../../scripts/lib/base-health-policy.mjs";

function run(name, conclusion, diagnostic = null) {
  return {
    id: `${name}-${conclusion}`,
    name,
    status: "completed",
    conclusion,
    app: { id: 10 },
    completed_at: "2026-08-01T00:00:00Z",
    ...(diagnostic ? { output: { summary: diagnostic, text: "" } } : {}),
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

test("classifies a shared failure only when diagnostic evidence matches", () => {
  const diagnostic = "FAIL src/auth.test.mjs: expected authorization to reject stale token";
  const result = evaluateBaseHealthSnapshot(
    snapshot({
      head: [run("CI", "failure", diagnostic)],
      base: [run("CI", "failure", diagnostic)],
    }),
  );
  assert.equal(result.decision, "blocked");
  assert.equal(result.sharedFailures.length, 1);
  assert.equal(result.prOnlyFailures.length, 0);
  assert.equal(result.scopeRecommendation, "separate_follow_up");
});

test("same failing check name with a different diagnostic remains unknown", () => {
  const result = evaluateBaseHealthSnapshot(
    snapshot({
      head: [run("CI", "failure", "FAIL src/new.test.mjs: expected 2 but received 3")],
      base: [run("CI", "failure", "FAIL src/old.test.mjs: expected true but received false")],
    }),
  );
  assert.equal(result.decision, "unknown");
  assert.equal(result.sharedFailures.length, 0);
  assert.equal(result.unknownFailures.length, 1);
  assert.equal(result.scopeRecommendation, "investigate");
  assert.match(result.perCheckOrigins[0].reason, /failure identity is unproven/);
});

test("same failing check name without diagnostic evidence remains unknown", () => {
  const result = evaluateBaseHealthSnapshot(
    snapshot({
      head: [run("CI", "failure")],
      base: [run("CI", "failure")],
    }),
  );
  assert.equal(result.decision, "unknown");
  assert.equal(result.sharedFailures.length, 0);
  assert.equal(result.unknownFailures.length, 1);
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

test("per-check origins explain strong shared evidence and PR-only failures", () => {
  const diagnostic = "FAIL src/shared.test.mjs: identical deterministic assertion";
  const result = evaluateBaseHealthSnapshot(
    snapshot({
      head: [run("shared", "failure", diagnostic), run("pr-only", "failure")],
      base: [run("shared", "failure", diagnostic), run("pr-only", "success")],
    }),
  );
  assert.equal(result.perCheckOrigins.length, 2);
  const shared = result.perCheckOrigins.find((row) => row.name === "shared");
  const prOnly = result.perCheckOrigins.find((row) => row.name === "pr-only");
  assert.equal(shared.origin, "base_preexisting");
  assert.equal(shared.baseGate, "fail");
  assert.match(shared.reason, /diagnostic fingerprint/);
  assert.equal(prOnly.origin, "pr_only");
  assert.equal(prOnly.baseGate, "pass");
  assert.match(prOnly.reason, /base check passes/);
});
