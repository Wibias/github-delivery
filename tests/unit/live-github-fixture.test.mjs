import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EXPECTED_WORKFLOWS,
  evaluateFixtureChecks,
  waitForExpectedChecks,
} from "../../scripts/lib/live-fixture-checks.mjs";
import {
  REQUIRED_EVENTS,
  assertSafeFixturePlan,
  buildFixturePlan,
  evaluateFixtureReceipt,
  runFixtureScenario,
} from "../../scripts/lib/live-github-fixture.mjs";

function check(workflow, name, bucket, state = bucket) {
  return { workflow, name, bucket, state, link: `https://example.test/${workflow}/${name}` };
}

test("builds namespaced deterministic fixture plans", () => {
  const plan = buildFixturePlan({ repo: "acme/widget", runId: "run-42" });
  assert.equal(plan.branch, "shipping-github-fixture/run-42");
  assert.equal(plan.fixturePath, ".shipping-github-fixtures/run-42.json");
  assert.match(plan.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.requiredEvents, REQUIRED_EVENTS);
  assertSafeFixturePlan(plan);
});

test("rejects unsafe fixture targets", () => {
  assert.throws(() => buildFixturePlan({ repo: "bad", runId: "abc" }), /OWNER\/REPO/);
  assert.throws(() => buildFixturePlan({ repo: "a/b", runId: ".." }), /runId/);
  const plan = { ...buildFixturePlan({ repo: "a/b", runId: "abc" }), branch: "main" };
  assert.throws(() => assertSafeFixturePlan(plan), /derived fields|non-fixture/);
});

test("reports approval-required workflow runs immediately", () => {
  const result = evaluateFixtureChecks({
    checks: [],
    runs: [{ name: "CI", status: "completed", conclusion: "action_required", url: "https://example.test/run" }],
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "fixture_workflows_approval_required");
  assert.match(result.message, /Approve workflows to run/);
});

test("treats no observed checks as incomplete evidence", () => {
  const result = evaluateFixtureChecks({ checks: [], runs: [] });
  assert.equal(result.state, "waiting");
  assert.equal(result.code, "fixture_checks_not_observed");
  assert.deepEqual(result.missingWorkflows, DEFAULT_EXPECTED_WORKFLOWS);
});

test("keeps pending checks incomplete", () => {
  const result = evaluateFixtureChecks({
    checks: [
      check("CI", "Node 22 / ubuntu-latest", "pending", "IN_PROGRESS"),
      check("Dependency Review", "dependency-review", "pass", "SUCCESS"),
      check("CodeQL", "Analyze", "pass", "SUCCESS"),
    ],
  });
  assert.equal(result.state, "waiting");
  assert.equal(result.code, "fixture_checks_pending");
  assert.deepEqual(result.pendingChecks, ["CI / Node 22 / ubuntu-latest"]);
});

test("fails immediately when any observed check fails", () => {
  const result = evaluateFixtureChecks({
    checks: [
      check("CI", "Node 22 / ubuntu-latest", "fail", "FAILURE"),
      check("Dependency Review", "dependency-review", "pass", "SUCCESS"),
      check("CodeQL", "Analyze", "pass", "SUCCESS"),
    ],
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "fixture_checks_failed");
  assert.deepEqual(result.failedChecks, ["CI / Node 22 / ubuntu-latest"]);
});

test("waits when a required workflow has not appeared", () => {
  const result = evaluateFixtureChecks({
    checks: [
      check("CI", "Node 22 / ubuntu-latest", "pass", "SUCCESS"),
      check("Dependency Review", "dependency-review", "pass", "SUCCESS"),
    ],
  });
  assert.equal(result.state, "waiting");
  assert.equal(result.code, "fixture_required_checks_missing");
  assert.deepEqual(result.missingWorkflows, ["CodeQL"]);
});

test("passes only after every required workflow succeeds and records extras", () => {
  const checks = [
    check("CI", "Node 20 / ubuntu-latest", "pass", "SUCCESS"),
    check("CI", "Node 22 / ubuntu-latest", "pass", "SUCCESS"),
    check("Dependency Review", "dependency-review", "pass", "SUCCESS"),
    check("CodeQL", "Analyze", "pass", "SUCCESS"),
    check("External Review", "review", "pass", "SUCCESS"),
  ];
  const result = evaluateFixtureChecks({ checks });
  assert.equal(result.state, "ready");
  assert.equal(result.code, "fixture_checks_satisfied");
  assert.equal(result.summary.count, 5);
  assert.deepEqual(result.summary.observedWorkflows, ["CI", "CodeQL", "Dependency Review", "External Review"]);
  assert.deepEqual(result.summary.expectedWorkflows, DEFAULT_EXPECTED_WORKFLOWS);
});

test("times out fail-closed with the last incomplete evidence code", async () => {
  let now = 0;
  await assert.rejects(
    waitForExpectedChecks({
      readChecks: async () => [],
      readRuns: async () => [],
      timeoutMs: 20,
      intervalMs: 10,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    }),
    (error) => error.code === "fixture_checks_not_observed",
  );
});

test("runs the full lifecycle and proves stale-head rejection", async () => {
  const calls = [];
  const checks = {
    conclusion: "success",
    count: 3,
    expectedWorkflows: DEFAULT_EXPECTED_WORKFLOWS,
    observedWorkflows: DEFAULT_EXPECTED_WORKFLOWS,
    checks: [],
  };
  const adapter = {
    async createIssue() { calls.push("issue"); return { number: 7 }; },
    async createBranch() { calls.push("branch"); },
    async createDraftPr() { calls.push("pr"); return { number: 9 }; },
    async evaluateGate() { const prior = calls.filter((c) => c === "gate").length; calls.push("gate"); return { decision: prior === 0 ? "blocked" : "ready" }; },
    async markReady() { calls.push("ready"); },
    async waitForChecks() { calls.push("checks"); return checks; },
    async captureSnapshot() { calls.push("snapshot"); return { head: "old-head" }; },
    async changeHead() { calls.push("change"); },
    async attemptStaleHeadMutation() { calls.push("stale"); return { rejected: true }; },
    async closePr() { calls.push("close-pr"); },
    async closeIssue() { calls.push("close-issue"); },
    async deleteBranch() { calls.push("delete-branch"); },
  };
  const receipt = await runFixtureScenario(adapter, { repo: "acme/widget", runId: "run-42" });
  assert.equal(receipt.passed, true);
  assert.deepEqual(receipt.events.map((event) => event.name), REQUIRED_EVENTS);
  assert.deepEqual(receipt.checks, checks);
});

test("fails when the stale-head guard accepts a mutation", async () => {
  const adapter = {
    async createIssue() { return { number: 1 }; }, async createBranch() {},
    async createDraftPr() { return { number: 2 }; }, async evaluateGate() { return { decision: "blocked" }; },
    async markReady() {}, async waitForChecks() { return { conclusion: "success", count: 3, expectedWorkflows: DEFAULT_EXPECTED_WORKFLOWS, observedWorkflows: DEFAULT_EXPECTED_WORKFLOWS, checks: [] }; },
    async captureSnapshot() { return { head: "old" }; }, async changeHead() {},
    async attemptStaleHeadMutation() { return { rejected: false }; }, async bestEffortCleanup() {},
  };
  await assert.rejects(runFixtureScenario(adapter, { repo: "a/b", runId: "run-42" }), /unexpectedly succeeded/);
});

test("receipt validation detects missing and invalid evidence", () => {
  const plan = buildFixturePlan({ repo: "a/b", runId: "run-42" });
  const receipt = evaluateFixtureReceipt(plan, [
    { name: "draft_gate_observed", decision: "ready" },
    { name: "stale_head_rejected", outcome: "accepted" },
  ]);
  assert.equal(receipt.passed, false);
  assert.ok(receipt.problems.some((value) => value.includes("missing events")));
  assert.ok(receipt.problems.some((value) => value.includes("draft PR")));
  assert.ok(receipt.problems.some((value) => value.includes("stale head")));
  assert.ok(receipt.problems.some((value) => value.includes("checks evidence")));
});
