import assert from "node:assert/strict";
import test from "node:test";

import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";

test("routes a natural-language merge request to the merge workflow", () => {
  assert.deepEqual(routeShippingGithubPrompt("merge PR #32"), {
    skill: "shipping-github",
    workflow: "references/merge-pr.md",
    mutationMode: "maintainer",
    explicitActions: ["merge_pr", "post_comment", "post_issue_comment", "close_linked_issue"],
  });
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

test("does not trigger for local pre-PR debugging", () => {
  assert.equal(
    routeShippingGithubPrompt("help me fix a flaky local Vitest unit test"),
    null,
  );
});
