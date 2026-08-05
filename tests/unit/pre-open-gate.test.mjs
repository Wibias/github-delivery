import assert from "node:assert/strict";
import test from "node:test";
import { planReviewScope } from "../../scripts/lib/review-scope.mjs";
import { projectBugScope, projectSecurityScope } from "../../scripts/lib/review-scope-compat.mjs";

function file(path, patch = "", extra = {}) {
  return { path, patch, additions: 1, deletions: 1, status: "modified", ...extra };
}

function gateDecision(plan) {
  const bugScope = projectBugScope(plan);
  const securityScope = projectSecurityScope(plan);
  const blockers = [
    ...bugScope.requiredLenses.map((id) => `bug:requiredLenses:${id}`),
    ...securityScope.requiredSurfaces.map((id) => `security:requiredSurfaces:${id}`),
  ];
  const complete = plan.complete && bugScope.complete && securityScope.complete;
  return { decision: !complete ? "unknown" : blockers.length ? "blocked" : "ready", blockers };
}

test("pre-open gate: docs-only branch is ready", () => {
  const plan = planReviewScope({ repo: "acme/widget", pr: null, headRefOid: "abc", files: [file("docs/guide.md", "+Words only")] });
  const { decision, blockers } = gateDecision(plan);
  assert.equal(decision, "ready");
  assert.deepEqual(blockers, []);
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
