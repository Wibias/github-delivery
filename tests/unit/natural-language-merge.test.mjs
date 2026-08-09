import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

function read(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

test("merge PR natural language routes to the merge workflow", () => {
  const skill = read("SKILL.md");
  const merge = read("references/merge-pr.md");
  assert.match(skill, /Merge PR #N; why-good \+ thanks/);
  assert.match(skill, /references\/merge-pr\.md/);
  assert.match(merge, /Trigger:[\s\S]*merge pr #N/i);
  assert.match(merge, /The user speaks naturally/);
});

test("the merge workflow uses the driver + mutation broker instead of a bare merge", () => {
  const merge = read("references/merge-pr.md");
  assert.match(merge, /scripts\/merge-pr-driver\.mjs/);
  assert.match(merge, /scripts\/github-mutate\.mjs/);
  assert.match(merge, /merge_pr/);
  assert.match(merge, /--match-head-commit/);
  assert.doesNotMatch(merge, /^\s*gh pr merge\b/m);
});

test("merge documentation requires merge before the success-looking thank-you", () => {
  const merge = read("references/merge-pr.md");
  assert.match(merge, /Driver transaction order/);
  assert.match(merge, /1\. \*\*Merge\*\*/);
  assert.match(merge, /2\. \*\*Verify merge success\*\*/);
  assert.match(merge, /3\. \*\*Post-merge PR thank-you\*\*/);
  assert.match(merge, /do \*\*not\*\* post a success-looking/i);
  assert.doesNotMatch(merge, /\*\*Pre-merge PR comment\*\*/);
  assert.doesNotMatch(merge, /pre-merge why\/comment was posted/i);
});

test("the README presents natural language as the public API", () => {
  const readme = read("README.md");
  assert.match(readme, /merge PR #32/);
  assert.match(readme, /do \*\*not\*\* need to invoke Node scripts yourself/i);
  assert.match(
    readme,
    /\|\s*\*\*Merge\*\*\s*\|[^\n]*`references\/merge-pr\.md`\s*\|/i,
  );
});
