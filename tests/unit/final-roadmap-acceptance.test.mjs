import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectBugScope, projectSecurityScope } from "../../scripts/lib/review-scope-compat.mjs";
import { planReviewScope } from "../../scripts/lib/review-scope.mjs";

function plan(files) {
  return planReviewScope({ repo: "acme/widget", pr: 42, headRefOid: "abc", files });
}

test("logic diffs preserve mandatory security baseline surfaces", () => {
  const output = projectSecurityScope(plan([{ path: "src/math.ts", patch: "+export function add(a, b) { return a + b; }" }]));
  assert.deepEqual(output.baselineSurfaces, ["authn", "authz", "secrets_config", "injection"]);
  for (const surface of output.baselineSurfaces) {
    assert.ok(output.requiredSurfaces.includes(surface));
    assert.equal(output.matched[surface].baseline, true);
  }
});

test("evidence surfaces remain required alongside baselines", () => {
  const output = projectSecurityScope(plan([{ path: "src/admin.ts", patch: "-requireAdmin(user)\n+destroyAccount()" }]));
  assert.ok(output.evidenceRequiredSurfaces.includes("authz"));
  assert.ok(output.requiredSurfaces.includes("authz"));
  assert.equal(output.matched.authz.confidence, "high");
});

test("logic diffs preserve complementary bug umbrellas", () => {
  const output = projectBugScope(plan([{ path: "src/math.ts", patch: "+export function add(a, b) { return a + b; }" }]));
  assert.deepEqual(output.baselineLenses, ["silent_failures", "resource_leaks", "edge_cases"]);
  for (const lens of output.baselineLenses) {
    assert.ok(output.requiredLenses.includes(lens));
    assert.equal(output.lensEvidence[lens].baseline, true);
  }
});

test("detailed bug evidence is additive to umbrella lenses", () => {
  const output = projectBugScope(plan([{ path: "src/worker.ts", patch: "+const worker = new Worker(url);\n+worker.terminate();" }]));
  assert.ok(output.requiredLenses.includes("resource_leaks"));
  assert.ok(output.requiredLenses.includes("resource_lifecycle"));
  assert.ok(output.evidenceRequiredLenses.includes("resource_lifecycle"));
});

test("pure docs still skip both review axes", () => {
  const reviewPlan = plan([{ path: "docs/guide.md", patch: "+Words" }]);
  assert.deepEqual(projectSecurityScope(reviewPlan).requiredSurfaces, []);
  assert.deepEqual(projectBugScope(reviewPlan).requiredLenses, []);
});

test("live fixture establishes Git credentials before pushing", () => {
  const source = readFileSync(new URL("../../scripts/live-github-fixture.mjs", import.meta.url), "utf8");
  const setup = source.indexOf('run("gh", ["auth", "setup-git"]);');
  const push = source.indexOf('run("git", ["push", "origin"');
  assert.ok(setup >= 0, "expected gh auth setup-git");
  assert.ok(push > setup, "Git authentication must be configured before the first push");
});
