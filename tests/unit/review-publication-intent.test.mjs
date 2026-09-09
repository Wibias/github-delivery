import assert from "node:assert/strict";
import test from "node:test";

import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import { allowedMutationModes } from "../../scripts/lib/workflow-mode.mjs";

test("plain PR review routes to a read-only full review", () => {
  const route = routeShippingGithubPrompt("review PR #191");
  assert.equal(route?.workflow, "references/full-review-pr.md");
  assert.equal(route?.mutationMode, "read-only");
  assert.deepEqual(route?.explicitActions, []);
});

test("full review alone does not imply public verdict publication", () => {
  const route = routeShippingGithubPrompt("full review PR #191");
  assert.equal(route?.workflow, "references/full-review-pr.md");
  assert.equal(route?.mutationMode, "read-only");
  assert.deepEqual(route?.explicitActions, []);
});

test("explicit verdict publication grants only review-comment authority", () => {
  const route = routeShippingGithubPrompt("full review PR #191 and post the verdict");
  assert.equal(route?.workflow, "references/full-review-pr.md");
  assert.equal(route?.mutationMode, "review");
  assert.deepEqual(route?.explicitActions, ["post_comment"]);
});

test("full-review workflow accepts read-only execution", () => {
  assert.deepEqual(allowedMutationModes("references/full-review-pr.md"), [
    "read-only",
    "review",
    "maintainer",
  ]);
});
