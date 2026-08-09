import assert from "node:assert/strict";
import test from "node:test";

import {
  hasExplicitMergeIntent,
  routeShippingGithubPrompt,
} from "../../scripts/lib/skill-router.mjs";

test("routes a natural-language merge request to the merge workflow", () => {
  assert.deepEqual(routeShippingGithubPrompt("merge PR #32"), {
    skill: "github-delivery",
    workflow: "references/merge-pr.md",
    mutationMode: "maintainer",
    explicitActions: ["merge_pr", "post_comment", "post_issue_comment", "close_linked_issue"],
  });
});

test("assistant-directed merge questions still count as explicit requests", () => {
  assert.equal(hasExplicitMergeIntent("can you merge PR #32?"), true);
  assert.equal(routeShippingGithubPrompt("can you merge PR #32?").workflow, "references/merge-pr.md");
});

test("negated, deliberative, and quoted merge text grants no merge authority", () => {
  for (const prompt of [
    "do not merge PR #42",
    "don't merge PR #42",
    "never ship PR #42",
    "Should I merge PR #42?",
    "Why can't I merge PR #42?",
    "What happens if we merge PR #42?",
    'the bot said "merge PR #42"',
    '"merge PR #42"',
  ]) {
    assert.equal(hasExplicitMergeIntent(prompt), false, prompt);
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route?.mutationMode, "read-only", prompt);
    assert.deepEqual(route?.explicitActions, [], prompt);
    assert.notEqual(route?.workflow, "references/merge-pr.md", prompt);
  }
});

test("routes a bare full review with verdict-comment authority", () => {
  const route = routeShippingGithubPrompt("full review on PR #32");
  assert.equal(route.workflow, "references/full-review-pr.md");
  assert.equal(route.mutationMode, "review");
  assert.deepEqual(route.explicitActions, []);
});

test("routes full-review plus merge through a composed prepare-and-merge workflow", () => {
  const route = routeShippingGithubPrompt("full review PR #42 and merge it if it passes");
  assert.equal(route.workflow, "references/prepare-and-merge-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("routes fix-review-comments plus merge through prepare-and-merge", () => {
  const route = routeShippingGithubPrompt("fix the review comments on PR #18 and merge it");
  assert.equal(route.workflow, "references/prepare-and-merge-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("routes simplify plus merge through prepare-and-merge", () => {
  const route = routeShippingGithubPrompt("simplify PR #65 safely and merge it when green");
  assert.equal(route.workflow, "references/prepare-and-merge-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("routes status and watch requests without granting mutation authority", () => {
  assert.equal(
    routeShippingGithubPrompt("what is left on PR #41?").workflow,
    "references/status.md",
  );
  assert.equal(
    routeShippingGithubPrompt("watch PR #77 until it merges or needs me").mutationMode,
    "read-only",
  );
});

test("routes fix-and-merge-ready to the maintainer workflow", () => {
  const route = routeShippingGithubPrompt(
    "fix the review comments on PR #18 and make it merge ready",
  );
  assert.equal(route.workflow, "references/fix-pr-bots.md");
  assert.equal(route.mutationMode, "maintainer");
});

test("routes a supersede request to the supersede workflow", () => {
  const route = routeShippingGithubPrompt(
    "supersede PR #12 with PR #45 — close the old one and point everyone at the new one",
  );
  assert.equal(route.workflow, "references/supersede-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("supersede_pr"));
});

test("routes a maintainer overtake request to the overtake workflow", () => {
  const route = routeShippingGithubPrompt(
    "the author is unresponsive; I'm a maintainer and I will overtake PR #32 and finish it",
  );
  assert.equal(route.workflow, "references/overtake-pr.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("close_pr"));
});

test("does not trigger for local pre-PR debugging", () => {
  assert.equal(
    routeShippingGithubPrompt("help me fix a flaky local Vitest unit test"),
    null,
  );
});
