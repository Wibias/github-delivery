import assert from "node:assert/strict";
import test from "node:test";

import {
  hasExplicitMergeIntent,
  routeShippingGithubPrompt,
} from "../../scripts/lib/skill-router.mjs";

const deferred = [
  "merge PR #42 only after I confirm again",
  "review PR #42 and merge only if I later say so",
  "review PR #42 and merge after asking me again",
  "merge PR #42 when I approve it later",
  "ask me again before you merge PR #42",
  "wait for my confirmation before you merge PR #42",
];

for (const prompt of deferred) {
  test(`deferred authority is not immediate merge intent: ${prompt}`, () => {
    assert.equal(hasExplicitMergeIntent(prompt), false);
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route?.workflow, "references/status.md");
    assert.equal(route?.mutationMode, "read-only");
    assert.deepEqual(route?.explicitActions, []);
  });
}

test("direct present-tense merge authority remains explicit", () => {
  assert.equal(hasExplicitMergeIntent("please merge PR #42"), true);
  const route = routeShippingGithubPrompt("please merge PR #42");
  assert.equal(route?.workflow, "references/merge-pr.md");
  assert.equal(route?.mutationMode, "maintainer");
  assert.ok(route?.explicitActions.includes("merge_pr"));
});

test("merge-it and ship-it prefixes still require explicit merge intent", () => {
  for (const prompt of [
    "merge it only after I confirm",
    "merge it only after I confirm PR #42",
    "ship it only after I confirm",
    "merge it after asking me",
    "ship it, but do not merge PR #42",
  ]) {
    assert.equal(hasExplicitMergeIntent(prompt), false, prompt);
    const route = routeShippingGithubPrompt(prompt);
    assert.notEqual(route?.workflow, "references/merge-pr.md", prompt);
    assert.ok(!route?.explicitActions?.includes("merge_pr"), prompt);
  }
});

test("bare merge it and ship it remain merge-pr", () => {
  for (const prompt of ["merge it", "ship it"]) {
    assert.equal(hasExplicitMergeIntent(prompt), true, prompt);
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route?.workflow, "references/merge-pr.md", prompt);
    assert.ok(route?.explicitActions.includes("merge_pr"), prompt);
  }
});
