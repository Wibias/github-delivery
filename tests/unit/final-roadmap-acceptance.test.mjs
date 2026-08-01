import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  projectBugScope,
  projectSecurityScope,
} from "../../scripts/lib/review-scope-compat.mjs";
import { planReviewScope } from "../../scripts/lib/review-scope.mjs";

function plan(files) {
  return planReviewScope({
    repo: "acme/widget",
    pr: 42,
    headRefOid: "abc",
    files,
  });
}

test("logic diffs preserve mandatory security baseline surfaces", () => {
  const output = projectSecurityScope(
    plan([
      {
        path: "src/math.ts",
        patch: "+export function add(a, b) { return a + b; }",
      },
    ]),
  );
  assert.deepEqual(output.baselineSurfaces, [
    "authn",
    "authz",
    "secrets_config",
    "injection",
  ]);
  for (const surface of output.baselineSurfaces) {
    assert.ok(output.requiredSurfaces.includes(surface));
    assert.equal(output.matched[surface].baseline, true);
  }
});

test("evidence surfaces remain required alongside baselines", () => {
  const output = projectSecurityScope(
    plan([
      { path: "src/admin.ts", patch: "-requireAdmin(user)\n+destroyAccount()" },
    ]),
  );
  assert.ok(output.evidenceRequiredSurfaces.includes("authz"));
  assert.ok(output.requiredSurfaces.includes("authz"));
  assert.equal(output.matched.authz.confidence, "high");
});

test("logic diffs preserve complementary bug umbrellas", () => {
  const output = projectBugScope(
    plan([
      {
        path: "src/math.ts",
        patch: "+export function add(a, b) { return a + b; }",
      },
    ]),
  );
  assert.deepEqual(output.baselineLenses, [
    "silent_failures",
    "resource_leaks",
    "edge_cases",
  ]);
  for (const lens of output.baselineLenses) {
    assert.ok(output.requiredLenses.includes(lens));
    assert.equal(output.lensEvidence[lens].baseline, true);
  }
});

test("detailed bug evidence is additive to umbrella lenses", () => {
  const output = projectBugScope(
    plan([
      {
        path: "src/worker.ts",
        patch: "+const worker = new Worker(url);\n+worker.terminate();",
      },
    ]),
  );
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
  const bugReview = readFileSync(
    new URL("../../references/bug-review.md", import.meta.url),
    "utf8",
  );
  const fullReview = readFileSync(
    new URL("../../references/full-review-pr.md", import.meta.url),
    "utf8",
  );
  const cursorSection =
    bugReview.match(/#### Cursor([\s\S]*?)#### Claude/)?.[1] || "";
  const promptFence =
    cursorSection.match(/```text\s*\n([\s\S]*?)\n\s*```/)?.[1] || "";
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
  assert.match(
    fullReview,
    /do not construct or paraphrase a replacement prompt/i,
  );
});

test("full review refuses to stop while its verdict plan item is pending", () => {
  const skill = readFileSync(
    new URL("../../SKILL.md", import.meta.url),
    "utf8",
  );
  const sharedRules = readFileSync(
    new URL("../../references/shared-rules.md", import.meta.url),
    "utf8",
  );
  const fullReview = readFileSync(
    new URL("../../references/full-review-pr.md", import.meta.url),
    "utf8",
  );
  const bugReview = readFileSync(
    new URL("../../references/bug-review.md", import.meta.url),
    "utf8",
  );

  assert.match(skill, /Full-review completion lock/);
  assert.match(skill, /Publish final verdict/);
  assert.match(skill, /pending.*in_progress/is);
  assert.match(skill, /Only explicit user cancellation/i);

  assert.match(sharedRules, /Full-review verdict completion lock/);
  assert.match(sharedRules, /Publish final verdict/);
  assert.match(sharedRules, /pending.*in_progress.*never a done state/is);
  assert.match(
    sharedRules,
    /A blocker changes the verdict; it does not permit the workflow to omit it/i,
  );
  assert.match(sharedRules, /Only explicit user cancellation/i);

  const requiredFullReviewContracts = [
    "## Mandatory execution plan and completion lock",
    "`Publish final verdict`",
    "The run **MUST NOT stop, return, hand off, emit a final response, or report",
    "A blocker is input to the final verdict, not permission to skip it.",
    "The only permitted exit without a verdict is explicit user cancellation.",
  ];

  for (const contract of requiredFullReviewContracts) {
    assert.ok(
      fullReview.includes(contract),
      `missing full-review completion contract: ${contract}`,
    );
  }

  assert.match(fullReview, /Planning next moves/i);
  assert.match(fullReview, /pending CI/i);
  assert.match(fullReview, /failed Bugbot invocation/i);
  assert.match(fullReview, /GitHub publication is unavailable/i);
  assert.match(fullReview, /complete verdict in chat/i);

  assert.match(bugReview, /Cursor Bugbot liveness rule/);
  assert.match(bugReview, /Bugbot supplies advisory evidence/i);
  assert.match(bugReview, /Bugbot unavailable/i);
  assert.match(
    bugReview,
    /Never keep `Publish final verdict` pending.*wait indefinitely/is,
  );
});

test("new full-review runs publish new immutable verdict comments", () => {
  const skill = readFileSync(
    new URL("../../SKILL.md", import.meta.url),
    "utf8",
  );
  const sharedRules = readFileSync(
    new URL("../../references/shared-rules.md", import.meta.url),
    "utf8",
  );
  const fullReview = readFileSync(
    new URL("../../references/full-review-pr.md", import.meta.url),
    "utf8",
  );
  const commentDepth = readFileSync(
    new URL("../../references/comment-depth.md", import.meta.url),
    "utf8",
  );

  assert.match(skill, /full-review-run-id/);
  assert.match(
    skill,
    /new explicit `full-review-pr` invocation is always a new publication identity/i,
  );
  assert.match(skill, /MUST be posted as a new top-level PR comment/i);

  assert.match(sharedRules, /### Full-review verdict publication identity/);
  assert.match(
    sharedRules,
    /Each new explicit `full-review-pr` invocation is a new publication identity/i,
  );
  assert.match(
    sharedRules,
    /no comment with the exact current run marker exists.*post a new top-level PR/is,
  );
  assert.match(
    sharedRules,
    /completed verdict from an earlier run is immutable historical evidence/i,
  );
  assert.match(sharedRules, /idempotency boundary is the workflow run/i);

  assert.match(fullReview, /### Full-review run and publication identity/);
  assert.match(fullReview, /### Final verdict publication/);
  assert.match(
    fullReview,
    /Every completed full-review run MUST publish a new top-level PR conversation comment/i,
  );
  assert.match(
    fullReview,
    /If no exact current-run marker exists, use `post_comment`/i,
  );
  assert.match(
    fullReview,
    /Never edit a completed verdict from an earlier full-review run/i,
  );
  assert.match(fullReview, /posted new verdict comment/i);
  assert.match(
    fullReview,
    /must never describe a newly completed full review as `updated verdict[\s\n]+comment`/i,
  );

  assert.match(commentDepth, /Idempotent within one publication identity/i);
  assert.match(
    commentDepth,
    /new explicit full-review invocation.*MUST post a new verdict comment/is,
  );
  assert.match(
    commentDepth,
    /shipping-github:full-review-verdict run:<full-review-run-id> head:<reviewed-head-sha>/,
  );
});

test("full review owns a deterministic spec and standards method", () => {
  const methodUrl = new URL(
    "../../references/spec-standards-review.md",
    import.meta.url,
  );
  const smellsUrl = new URL("../../references/code-smells.md", import.meta.url);
  const fullReview = readFileSync(
    new URL("../../references/full-review-pr.md", import.meta.url),
    "utf8",
  );

  assert.ok(
    existsSync(methodUrl),
    "expected bundled spec/standards review method",
  );
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
  const source = readFileSync(
    new URL("../../scripts/live-github-fixture.mjs", import.meta.url),
    "utf8",
  );
  const setup = source.indexOf('run("gh", ["auth", "setup-git"]);');
  const push = source.indexOf('run("git", ["push", "origin"');
  assert.ok(setup >= 0, "expected gh auth setup-git");
  assert.ok(
    push > setup,
    "Git authentication must be configured before the first push",
  );
});

test("ship-gate snapshot does not request org-scoped reviewer identities through gh pr view", () => {
  const source = readFileSync(
    new URL("../../scripts/ship-gate-snapshot.mjs", import.meta.url),
    "utf8",
  );
  const prViewFields =
    source.match(
      /"number,title,state,isDraft,url,baseRefName,headRefOid,mergeStateStatus,mergeable,reviewDecision,[^"]+"/,
    )?.[0] || "";

  assert.doesNotMatch(prViewFields, /reviewRequests/);
  assert.match(source, /pulls\/\$\{pr\}\/requested_reviewers/);
  assert.match(source, /users/);
  assert.match(source, /teams/);
});
