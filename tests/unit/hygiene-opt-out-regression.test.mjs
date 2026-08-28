import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("simplify opt-outs do not grant push_code on a bare full review", () => {
  for (const prompt of [
    "full review PR #42 without simplify",
    "full review PR #42 skip simplify",
    "full review PR #42 don't simplify",
  ]) {
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route.workflow, "references/full-review-pr.md", prompt);
    assert.equal(route.mutationMode, "review", prompt);
    assert.deepEqual(route.explicitActions, [], prompt);
  }
});

test("simplify opt-outs do not grant push_code through prepare-and-merge", () => {
  for (const prompt of [
    "full review PR #42 without simplify and merge it if clean",
    "review PR #42 skip simplify and merge it when green",
  ]) {
    const route = routeShippingGithubPrompt(prompt);
    assert.equal(route.workflow, "references/prepare-and-merge-pr.md", prompt);
    assert.ok(route.explicitActions.includes("merge_pr"), prompt);
    assert.ok(!route.explicitActions.includes("push_code"), prompt);
  }
});

const COMPOSED = [
  "references/full-review-pr.md",
  "references/re-review-pr.md",
  "references/fix-pr-bots.md",
  "references/create-pr-for-issue.md",
  "references/create-pr-from-local-work.md",
  "references/prepare-and-merge-pr.md",
];

test("composed workflow prose never combines independent hygiene opt-outs into one gate", () => {
  const combinedOptOutList = /\([^)]*skip no-comments[^)]*without simplify[^)]*\)/i;
  for (const path of COMPOSED) {
    assert.doesNotMatch(read(path), combinedOptOutList, path);
  }
});
