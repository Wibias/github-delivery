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
  assert.match(git, /originalLocalTip/);
  assert.match(git, /tree matches/);
  assert.match(git, /rewriteExemption/);
  assert.match(stacks, /GD-GIT-008/);
  assert.match(stacks, /originalLocalTip/);
  assert.match(stacks, /rewriteExemption/);
  assert.match(stacks, /"rewriteExemption": "restack"/);
});

test("PR descriptions call out core versus generated files", () => {
  const body = read("references/pr-description.md");
  assert.match(body, /Review notes/);
  assert.match(body, /core/i);
  assert.match(body, /generated|mechanical/i);
});

test("README treats moved-code hints as review labels, not suppressions", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /only suppress exact unchanged relocations/);
  assert.match(readme, /distinguish exact raw-text relocations/);
  assert.match(readme, /keeping surrounding context in review/);
});

test("full review treats textual relocation as a hint, not proof of unchanged behavior", () => {
  const review = read("references/full-review-pr.md");
  assert.match(review, /moved code|relocated/i);
  assert.match(review, /review-brief/);
  assert.match(review, /textually identical|identical reloc/i);
  assert.match(review, /surrounding context still requires review/i);
  assert.doesNotMatch(review, /not new logic|Do not treat those exact moves as new logic/);
  assert.match(review, /stay in review|Near relocations/i);
});
