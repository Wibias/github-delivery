import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("git policy binds content-preserving rewrites to the original tree", () => {
  const git = read("references/policy/git.md");
  const stacks = read("references/stacked-prs.md");
  assert.match(git, /GD-GIT-008/);
  assert.match(git, /tree matches/);
  assert.match(git, /rewriteExemption/);
  assert.match(stacks, /GD-GIT-008/);
  assert.match(stacks, /rewriteExemption/);
  assert.match(stacks, /"rewriteExemption": "restack"/);
});

test("PR descriptions call out core versus generated files", () => {
  const body = read("references/pr-description.md");
  assert.match(body, /Review notes/);
  assert.match(body, /core/i);
  assert.match(body, /generated|mechanical/i);
});

test("full review treats only exact relocated blocks as not new logic", () => {
  const review = read("references/full-review-pr.md");
  assert.match(review, /moved code|relocated/i);
  assert.match(review, /review-brief/);
  assert.match(review, /exact relocate|exact relocated|unchanged lines/i);
  assert.match(review, /still in review|Near relocations/i);
});
