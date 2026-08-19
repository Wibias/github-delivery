import assert from "node:assert/strict";
import test from "node:test";

import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";

function assertFixRoute(route) {
  assert.equal(route?.workflow, "references/fix-pr-bots.md");
  assert.equal(route?.mutationMode, "maintainer");
  assert.deepEqual(route?.explicitActions, ["push_code"]);
}

test("explicit PR make-green requests route deterministically", () => {
  for (const prompt of [
    "make PR #42 green",
    "get pull request #42 green",
    "fix CI on PR #42",
    "fix the failing checks for pull request #42",
  ]) {
    assertFixRoute(routeShippingGithubPrompt(prompt));
  }
});

test("bare make-green shorthand requires an active PR context", () => {
  assert.equal(routeShippingGithubPrompt("make this green"), null);
  assertFixRoute(
    routeShippingGithubPrompt("make this green", { activePullRequest: { number: 42 } }),
  );
  assertFixRoute(
    routeShippingGithubPrompt("fix CI", { activePrNumber: 42 }),
  );
});

test("unrelated green language does not activate GitHub delivery", () => {
  for (const prompt of [
    "make this button green",
    "make the dashboard green",
    "I like this shade of green",
  ]) {
    assert.equal(routeShippingGithubPrompt(prompt), null, prompt);
  }
});
