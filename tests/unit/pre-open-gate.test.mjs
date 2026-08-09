import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { planReviewScope } from "../../scripts/lib/review-scope.mjs";
import { evaluate } from "../../scripts/pre-open-gate.mjs";
import { validatePreOpenEvidence, evidenceClears } from "../../scripts/lib/pre-open-evidence.mjs";

function file(path, patch = "", extra = {}) {
  return { path, patch, additions: 1, deletions: 1, status: "modified", ...extra };
}

function gateDecision(plan) {
  const { decision, blockers } = evaluate(plan);
  return { decision, blockers };
}

test("pre-open gate: docs-only branch is ready", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("docs/guide.md", "+Words only")] });
  const { decision, blockers } = gateDecision(plan);
  assert.equal(decision, "ready");
  assert.deepEqual(blockers, []);
});

test("pre-open gate: empty candidate diff is blocked until implementation exists", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "base", files: [] });
  const result = evaluate(plan);
  assert.equal(result.decision, "blocked");
  assert.equal(result.implementationDiffPresent, false);
  assert.deepEqual(result.blockers, ["workflow:implementation_missing"]);
});

test("pre-open gate: logic-bearing branch is blocked with required lenses", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("src/worker.ts", "+const worker = new Worker(url);\n+worker.terminate();")] });
  const { decision, blockers } = gateDecision(plan);
  assert.equal(decision, "blocked");
  assert.ok(blockers.includes("bug:requiredLenses:resource_leaks"));
  assert.ok(blockers.includes("security:requiredSurfaces:authn"));
});

test("pre-open gate: removed authz control blocks on the authz surface", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("src/api/admin.ts", "-if (!requireAdmin(user)) throw forbidden();\n+return destroyAccount();")] });
  const { decision, blockers } = gateDecision(plan);
  assert.equal(decision, "blocked");
  assert.ok(blockers.includes("security:requiredSurfaces:authz"));
});

test("pre-open gate: missing patch makes the decision unknown (never open)", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("src/auth/login.ts", "")] });
  const { decision } = gateDecision(plan);
  assert.equal(decision, "unknown");
});

test("pre-open gate: evidence covering every required lens/surface clears blocked to ready", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("src/worker.ts", "+const worker = new Worker(url);\n+worker.terminate();")] });
  const evidence = {
    schemaVersion: 1,
    lenses: {
      silent_failures: "done",
      resource_leaks: "done",
      edge_cases: "done",
      concurrency_races: "done",
      resource_lifecycle: "done",
    },
    surfaces: {
      authn: "n/a no auth boundary touched",
      authz: "n/a no authorization boundary touched",
      secrets_config: "n/a no secrets or config touched",
      injection: "n/a no untrusted input or shell execution",
    },
  };
  const { decision, blockers, clearedByEvidence, evidenceApplied } = evaluate(plan, evidence);
  assert.equal(evidenceApplied, true);
  assert.equal(decision, "ready");
  assert.deepEqual(blockers, []);
  assert.equal(clearedByEvidence.length, 9);
});

test("pre-open gate: partial evidence stays blocked and lists the remaining blockers", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("src/worker.ts", "+const worker = new Worker(url);\n+worker.terminate();")] });
  const evidence = {
    schemaVersion: 1,
    lenses: { silent_failures: "done" },
    surfaces: {},
  };
  const { decision, blockers } = evaluate(plan, evidence);
  assert.equal(decision, "blocked");
  assert.ok(blockers.includes("bug:requiredLenses:resource_leaks"));
  assert.ok(blockers.includes("security:requiredSurfaces:authn"));
  assert.ok(!blockers.includes("bug:requiredLenses:silent_failures"));
});

test("pre-open gate: evidence does not change the unknown decision", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("src/auth/login.ts", "")] });
  const evidence = { schemaVersion: 1, lenses: {}, surfaces: {} };
  const { decision } = evaluate(plan, evidence);
  assert.equal(decision, "unknown");
});

test("pre-open gate: evidence cannot clear a missing implementation diff", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "base", files: [] });
  const evidence = { schemaVersion: 1, lenses: {}, surfaces: {} };
  const result = evaluate(plan, evidence);
  assert.equal(result.decision, "blocked");
  assert.deepEqual(result.blockers, ["workflow:implementation_missing"]);
});

test("pre-open gate: invalid evidence is rejected by validation", () => {
  const invalid = validatePreOpenEvidence({ lenses: { silent_failures: "maybe" }, surfaces: {} });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes("invalid status")));
});

test("pre-open gate: n/a evidence requires a reason", () => {
  const bare = validatePreOpenEvidence({ lenses: { silent_failures: "n/a" }, surfaces: {} });
  assert.equal(bare.ok, false);
  assert.ok(bare.errors.some((error) => error.includes("requires a reason")));
  const withReason = validatePreOpenEvidence({ lenses: { silent_failures: "n/a boundary untouched" }, surfaces: {} });
  assert.equal(withReason.ok, true);
});

test("pre-open gate: evidenceClears accepts done and n/a-with-reason only", () => {
  assert.equal(evidenceClears({ silent_failures: "done" }, "silent_failures"), true);
  assert.equal(evidenceClears({ silent_failures: "n/a boundary untouched" }, "silent_failures"), true);
  assert.equal(evidenceClears({ silent_failures: "n/a" }, "silent_failures"), false);
  assert.equal(evidenceClears({ silent_failures: "maybe" }, "silent_failures"), false);
  assert.equal(evidenceClears({}, "silent_failures"), false);
});

test("create-pr workflow has a bounded research-to-implementation transition", () => {
  const workflow = readFileSync("references/create-pr-for-issue.md", "utf8");
  const implementationIndex = workflow.indexOf("### D. Implement locally");
  const gateIndex = workflow.indexOf("### D2. Pre-open bug + security gate");

  assert.ok(implementationIndex >= 0, "implementation phase must exist");
  assert.ok(gateIndex > implementationIndex, "pre-open gate must run after implementation");
  assert.match(workflow, /Preflight completion boundary/);
  assert.match(workflow, /Do not re-enter preflight/);
  assert.match(workflow, /Finding another implementation call site[\s\S]*not by itself/);
  assert.doesNotMatch(workflow, /required — before coding or opening/);
});

test("research workflow hands composed create-pr work off instead of looping", () => {
  const workflow = readFileSync("references/research-issue.md", "utf8");
  assert.match(workflow, /Composition handoff to create-PR/);
  assert.match(workflow, /research is complete/i);
  assert.match(workflow, /Do \*\*not\*\* continue repository-wide call-site/);
  assert.match(workflow, /implementation discovery, \*\*not a reason to reopen research\*\*/);
});

test("entrypoint and README describe create-pr phases in forward-progress order", () => {
  const skill = readFileSync("SKILL.md", "utf8");
  const readme = readFileSync("README.md", "utf8");

  assert.match(skill, /bounded preflight → implement → pre-open bug\/security gate/);
  assert.match(skill, /post-implementation and pre-publication/);
  assert.doesNotMatch(skill, /preflight \+ pre-open bug\/security gate\) first/);
  assert.match(readme, /bounded \*\*research → implementation → pre-open review\*\* sequence/);
  assert.doesNotMatch(readme, /pre-open bug\/security gate first/);
});
