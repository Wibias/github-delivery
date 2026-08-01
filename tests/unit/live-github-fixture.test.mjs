import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_EVENTS,
  assertSafeFixturePlan,
  buildFixturePlan,
  evaluateFixtureReceipt,
  runFixtureScenario,
} from "../../scripts/lib/live-github-fixture.mjs";

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

test("runs the full lifecycle and proves stale-head rejection", async () => {
  const calls = [];
  const adapter = {
    async createIssue() { calls.push("issue"); return { number: 7 }; },
    async createBranch() { calls.push("branch"); },
    async createDraftPr() { calls.push("pr"); return { number: 9 }; },
    async evaluateGate() { const prior = calls.filter((c) => c === "gate").length; calls.push("gate"); return { decision: prior === 0 ? "blocked" : "ready" }; },
    async markReady() { calls.push("ready"); },
    async waitForChecks() { calls.push("checks"); return { conclusion: "success" }; },
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
});

test("fails when the stale-head guard accepts a mutation", async () => {
  const adapter = {
    async createIssue() { return { number: 1 }; }, async createBranch() {},
    async createDraftPr() { return { number: 2 }; }, async evaluateGate() { return { decision: "blocked" }; },
    async markReady() {}, async waitForChecks() { return { conclusion: "success" }; },
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
});
