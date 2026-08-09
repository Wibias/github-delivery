import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("skill defaults to read-only and names every mutation profile", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /Default mutation mode is\s+read-only/);
  for (const mode of ["read-only", "review", "maintainer", "autonomous"]) {
    assert.match(skill, new RegExp(`\\b${mode}\\b`));
  }
  assert.match(skill, /Human replies always require exact-text confirmation/);
});

test("mutation mode reference keeps human replies and full-review verdicts trusted", () => {
  const reference = read("references/mutation-modes.md");
  assert.match(reference, /Reply to a human thread/);
  assert.match(reference, /exact text \+ trusted authority required/);
  assert.match(reference, /Publish a full-review verdict/);
  assert.match(reference, /trusted authority required/);
  assert.match(reference, /generic `post_comment`[\s\S]*never satisfies merge review evidence/i);
  assert.match(reference, /profile is an upper bound, not a waiver/);
});

test("bare full review selects review mode with verdict authority", () => {
  const reference = read("references/mutation-modes.md");
  assert.match(reference, /full review PR #32/);
  assert.match(reference, /full review PR #32[\s\S]*→ `review`/);
  assert.match(reference, /full-review verdict[\s\S]*trusted authority/i);
});

test("gate helper invocation carries the active mutation mode", () => {
  const reference = read("references/gate-helpers.md");
  assert.match(reference, /ship-gate\.mjs[\s\S]*--mutation-mode read-only/);
  assert.match(reference, /mutation-policy\.mjs/);
});

test("router authority and verdict verification are documented", () => {
  const reference = read("references/mutation-modes.md");
  const helpers = read("references/gate-helpers.md");
  assert.match(reference, /## Router authority/);
  assert.match(reference, /routed mutation mode plus `--workflow`/);
  assert.match(reference, /self-selected mode is a workflow violation/i);
  assert.match(helpers, /verify-verdict-published\.mjs/);
  assert.match(helpers, /--workflow references\/full-review-pr\.md/);
});
