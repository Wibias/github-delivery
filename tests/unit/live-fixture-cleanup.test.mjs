import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildInterruptedReceipt,
  cleanupFixtureResources,
} from "../../scripts/lib/live-fixture-cleanup.mjs";
import {
  buildFixturePlan,
  runFixtureScenario,
} from "../../scripts/lib/live-github-fixture.mjs";

test("builds a failed receipt for an interrupted lifecycle", () => {
  const plan = buildFixturePlan({ repo: "acme/widget", runId: "gha-42-1" });
  const receipt = buildInterruptedReceipt(plan, {
    code: "fixture_lifecycle_interrupted",
    message: "The lifecycle process ended before writing a receipt.",
  });
  assert.equal(receipt.passed, false);
  assert.equal(receipt.failure.code, "fixture_lifecycle_interrupted");
  assert.equal(receipt.repo, "acme/widget");
  assert.equal(receipt.runId, "gha-42-1");
  assert.deepEqual(receipt.events, []);
  assert.equal(receipt.checks, null);
});

test("scenario errors carry a partial failed receipt", async () => {
  const adapter = {
    async createIssue() { return { number: 7 }; },
    async createBranch() {},
    async createDraftPr() { return { number: 9 }; },
    async evaluateGate() { return { decision: "blocked" }; },
    async markReady() {},
    async waitForChecks() {
      const error = new Error("fixture_checks_not_observed: no checks");
      error.code = "fixture_checks_not_observed";
      throw error;
    },
    async bestEffortCleanup() {},
  };
  await assert.rejects(
    runFixtureScenario(adapter, { repo: "acme/widget", runId: "gha-42-1" }),
    (error) => {
      assert.equal(error.fixtureReceipt.passed, false);
      assert.equal(error.fixtureReceipt.failure.code, "fixture_checks_not_observed");
      assert.ok(error.fixtureReceipt.events.some((event) => event.name === "draft_pr_created"));
      return true;
    },
  );
});

test("cleanup closes exact open fixture resources and deletes its branch", async () => {
  const calls = [];
  const adapter = {
    async findPr(plan) { calls.push(["find-pr", plan.prTitle]); return { number: 9, state: "OPEN", title: plan.prTitle }; },
    async findIssue(plan) { calls.push(["find-issue", plan.issueTitle]); return { number: 7, state: "OPEN", title: plan.issueTitle }; },
    async branchExists(plan) { calls.push(["branch-exists", plan.branch]); return true; },
    async closePr(_plan, pr) { calls.push(["close-pr", pr.number]); },
    async closeIssue(_plan, issue) { calls.push(["close-issue", issue.number]); },
    async deleteBranch(plan) { calls.push(["delete-branch", plan.branch]); },
  };
  const report = await cleanupFixtureResources(adapter, { repo: "acme/widget", runId: "gha-42-1" });
  assert.equal(report.complete, true);
  assert.deepEqual(report.actions.map((action) => action.action), ["close_pr", "close_issue", "delete_branch"]);
  assert.deepEqual(calls, [
    ["find-pr", "[github-delivery-fixture:gha-42-1] lifecycle PR"],
    ["find-issue", "[github-delivery-fixture:gha-42-1] lifecycle issue"],
    ["branch-exists", "github-delivery-fixture/gha-42-1"],
    ["close-pr", 9],
    ["close-issue", 7],
    ["delete-branch", "github-delivery-fixture/gha-42-1"],
  ]);
});

test("cleanup is idempotent when resources are already gone", async () => {
  const adapter = {
    async findPr() { return { number: 9, state: "CLOSED" }; },
    async findIssue() { return { number: 7, state: "CLOSED" }; },
    async branchExists() { return false; },
  };
  const report = await cleanupFixtureResources(adapter, { repo: "acme/widget", runId: "gha-42-1" });
  assert.equal(report.complete, true);
  assert.deepEqual(report.actions, []);
});

test("cleanup records failures without targeting unrelated resources", async () => {
  const adapter = {
    async findPr(plan) { return { number: 9, state: "OPEN", title: plan.prTitle }; },
    async findIssue() { return null; },
    async branchExists() { return true; },
    async closePr() { throw new Error("close denied"); },
    async deleteBranch() { throw new Error("delete denied"); },
  };
  const report = await cleanupFixtureResources(adapter, { repo: "acme/widget", runId: "gha-42-1" });
  assert.equal(report.complete, false);
  assert.deepEqual(report.failures.map((failure) => failure.action), ["close_pr", "delete_branch"]);
});

test("workflow runs cancellation-safe cleanup before uploading both reports", () => {
  const source = readFileSync(new URL("../../.github/workflows/live-integration.yml", import.meta.url), "utf8");
  const cleanup = source.indexOf("name: Clean up fixture resources");
  const upload = source.indexOf("name: Upload lifecycle evidence");
  assert.ok(cleanup >= 0, "expected an explicit cleanup step");
  assert.ok(upload > cleanup, "cleanup must run before artifact upload");
  assert.match(source.slice(cleanup, upload), /if:\s*always\(\)/);
  assert.match(source, /live-fixture-receipt\.json/);
  assert.match(source, /live-fixture-cleanup\.json/);
  assert.doesNotMatch(source, /if-no-files-found:\s*warn/);
});

test("workflow requires a dedicated fixture credential before mutation", () => {
  const source = readFileSync(new URL("../../.github/workflows/live-integration.yml", import.meta.url), "utf8");
  const token = source.indexOf("name: Create fixture-scoped GitHub App token");
  const preflight = source.indexOf("name: Verify live fixture credential");
  const exercise = source.indexOf("name: Exercise live GitHub lifecycle");
  const cleanup = source.indexOf("name: Clean up fixture resources");
  const upload = source.indexOf("name: Upload lifecycle evidence");

  assert.ok(token >= 0, "expected a fixture-scoped GitHub App token step");
  assert.ok(token < preflight, "fixture token must be created before credential preflight");
  assert.ok(preflight < exercise, "credential preflight must run before fixture mutation");
  assert.match(source.slice(token, preflight), /private-key:\s*\$\{\{\s*secrets\.LIVE_FIXTURE_APP_PRIVATE_KEY\s*\}\}/);
  assert.match(source.slice(token, preflight), /repositories:\s*\$\{\{\s*vars\.LIVE_FIXTURE_REPOSITORY\s*\}\}/);
  assert.match(source.slice(preflight, exercise), /GH_TOKEN:\s*\$\{\{\s*steps\.fixture-app-token\.outputs\.token\s*\}\}/);
  assert.match(source.slice(preflight, exercise), /--installation-id\s+"\$\{\{\s*steps\.fixture-app-token\.outputs\.installation-id\s*\}\}"/);
  assert.match(source.slice(exercise, cleanup), /GH_TOKEN:\s*\$\{\{\s*steps\.fixture-app-token\.outputs\.token\s*\}\}/);
  assert.match(source.slice(cleanup, upload), /GH_TOKEN:\s*\$\{\{\s*steps\.fixture-app-token\.outputs\.token\s*\}\}/);
  assert.match(source, /node scripts\/verify-live-fixture-token\.mjs/);
  assert.doesNotMatch(source, /LIVE_FIXTURE_TOKEN/);
  assert.doesNotMatch(source, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
});

test("credential preflight preserves the verifier exit code through tee", () => {
  const source = readFileSync(new URL("../../.github/workflows/live-integration.yml", import.meta.url), "utf8");
  const preflight = source.indexOf("name: Verify live fixture credential");
  const exercise = source.indexOf("name: Exercise live GitHub lifecycle");
  const block = source.slice(preflight, exercise);

  assert.match(block, /set\s+-o\s+pipefail/);
  assert.match(block, /verify-live-fixture-token\.mjs[\s\S]*\|\s*tee\s+live-fixture-credential\.json/);
});
