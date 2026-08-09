import assert from "node:assert/strict";
import test from "node:test";

import {
  baseFailingNames,
  checkName,
  classify,
  conclusionOf,
  failingChecks,
} from "../../scripts/ci-forensics.mjs";

function run(name, conclusion, startedAt = "2026-08-01T00:00:00Z") {
  return { id: `${name}-${conclusion}`, name, conclusion, started_at: startedAt };
}

test("conclusionOf maps GitHub conclusions to pass/fail/pending", () => {
  assert.equal(conclusionOf({ conclusion: "success" }), "pass");
  assert.equal(conclusionOf({ conclusion: "neutral" }), "pass");
  assert.equal(conclusionOf({ conclusion: "failure" }), "fail");
  assert.equal(conclusionOf({ conclusion: "action_required" }), "fail");
  assert.equal(conclusionOf({ conclusion: null, status: "in_progress" }), "pending");
});

test("failingChecks keeps only the latest run per check name", () => {
  const rows = [
    run("react-doctor", "failure", "2026-08-01T00:00:00Z"),
    run("react-doctor", "failure", "2026-08-01T01:00:00Z"),
    run("test", "success", "2026-08-01T00:00:00Z"),
  ];
  const result = failingChecks(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "react-doctor");
  assert.equal(result[0].started_at, "2026-08-01T01:00:00Z");
});

test("checkName falls back to context", () => {
  assert.equal(checkName({ name: "CI" }), "CI");
  assert.equal(checkName({ context: "status-context" }), "status-context");
  assert.equal(checkName({}), "unnamed");
});

test("baseFailingNames collects failing base check and status names", () => {
  const names = baseFailingNames({
    checkRuns: [run("CI", "failure"), run("tests", "success")],
    statuses: [{ context: "lint", state: "failure" }],
  });
  assert.equal(names.has("CI"), true);
  assert.equal(names.has("tests"), false);
  assert.equal(names.has("lint"), true);
});

test("classify treats a shared check name as common surface, not proven base root cause", () => {
  assert.equal(classify("CI", true, new Set(["CI"])), "common_failing_check");
  assert.equal(classify("CI", true, new Set()), "pr_only_or_unknown");
  assert.equal(classify("CI", false, new Set(["CI"])), "not_failing");
});
