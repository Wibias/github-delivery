import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("Cursor full review uses Bugbot's exact two-line prompt and nothing else", () => {
  const bugReview = readFileSync(new URL("../../references/bug-review.md", import.meta.url), "utf8");
  const fullReview = readFileSync(new URL("../../references/full-review-pr.md", import.meta.url), "utf8");
  const cursorSection = bugReview.match(/#### Cursor([\s\S]*?)#### Claude/)?.[1] || "";
  const promptFence = cursorSection.match(/```text\s*\n([\s\S]*?)\n\s*```/)?.[1] || "";
  const promptLines = promptFence
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.deepEqual(promptLines, [
    "Full Repository Path: <absolute path to the checked-out repository>",
    "Diff: branch changes",
  ]);
  assert.doesNotMatch(cursorSection, /Base Reference:/);
  assert.doesNotMatch(cursorSection, /Change Description:/);
  assert.match(cursorSection, /exactly two lines/i);
  assert.match(cursorSection, /nothing after/i);
  assert.match(bugReview, /do not paraphrase/i);
  assert.match(bugReview, /Do \*\*not\*\* use `OWNER\/REPO`/);
  assert.match(fullReview, /literal `review-bugbot` prompt contract/);
  assert.match(fullReview, /do not construct or paraphrase a replacement prompt/i);
});

test("full review owns a deterministic spec and standards method", () => {
  const methodUrl = new URL("../../references/spec-standards-review.md", import.meta.url);
  const smellsUrl = new URL("../../references/code-smells.md", import.meta.url);
  const fullReview = readFileSync(new URL("../../references/full-review-pr.md", import.meta.url), "utf8");

  assert.ok(existsSync(methodUrl), "expected bundled spec/standards review method");
  assert.ok(existsSync(smellsUrl), "expected bundled code-smell baseline");

  const method = readFileSync(methodUrl, "utf8");
  const smells = readFileSync(smellsUrl, "utf8");
  const expectedSmells = [
    "Mysterious Name",
    "Duplicated Code",
    "Feature Envy",
    "Data Clumps",
    "Primitive Obsession",
    "Repeated Switches",
    "Shotgun Surgery",
    "Divergent Change",
    "Speculative Generality",
    "Message Chains",
    "Middle Man",
    "Refused Bequest",
  ];

  assert.match(fullReview, /references\/spec-standards-review\.md/);
  assert.match(method, /git diff <base>\.\.\.<head>/);
  assert.match(method, /## Standards/);
  assert.match(method, /## Spec/);
  assert.match(method, /repo standards override/i);
  assert.match(method, /judgement call/i);
  for (const smell of expectedSmells) {
    assert.match(smells, new RegExp(`\\*\\*${smell}\\*\\*`));
  }
});

test("live fixture establishes Git credentials before pushing", () => {
  const source = readFileSync(new URL("../../scripts/live-github-fixture.mjs", import.meta.url), "utf8");
  const setup = source.indexOf('run("gh", ["auth", "setup-git"]);');
  const push = source.indexOf('run("git", ["push", "origin"');
  assert.ok(setup >= 0, "expected gh auth setup-git");
  assert.ok(push > setup, "Git authentication must be configured before the first push");
});

test("ship-gate snapshot does not request org-scoped reviewer identities through gh pr view", () => {
  const source = readFileSync(new URL("../../scripts/ship-gate-snapshot.mjs", import.meta.url), "utf8");
  const prViewFields = source.match(/"number,title,state,isDraft,url,baseRefName,headRefOid,mergeStateStatus,mergeable,reviewDecision,[^"]+"/)?.[0] || "";

  assert.doesNotMatch(prViewFields, /reviewRequests/);
  assert.match(source, /pulls\/\$\{pr\}\/requested_reviewers/);
  assert.match(source, /users/);
  assert.match(source, /teams/);
});
