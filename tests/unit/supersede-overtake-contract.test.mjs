import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

test("supersede workflow closes the obsolete PR, never merges it", () => {
  const supersede = read("references/supersede-pr.md");
  assert.match(supersede, /# Supersede a pull request/);
  assert.match(supersede, /closed\*\*, never merged/);
  assert.match(supersede, /replacement PR/);
  assert.match(supersede, /supersede_pr/);
  assert.match(supersede, /github-mutate\.mjs/);
  assert.match(supersede, /idempotencyKey/);
  assert.match(supersede, /linked issues/);
  assert.match(supersede, /never merges/);
});

test("overtake workflow requires unresponsive author and maintainer rights", () => {
  const overtake = read("references/overtake-pr.md");
  assert.match(overtake, /# Maintainer overtake of a pull request/);
  assert.match(overtake, /author is genuinely unavailable/);
  assert.match(overtake, /push rights/);
  assert.match(overtake, /fork-head unwritable/);
  assert.match(overtake, /fix-pr-bots\.md/);
  assert.match(overtake, /close-with-reference/);
  assert.match(overtake, /\*\*not\*\* authorize merging|authorize merging by itself/);
});

test("shared rules carry supersede and overtake assertions", () => {
  const sharedRules = read("references/shared-rules.md");
  assert.match(sharedRules, /## Supersede and maintainer overtake/);
  assert.match(sharedRules, /Supersede a PR/);
  assert.match(sharedRules, /Maintainer overtake/);
  assert.match(sharedRules, /supersede-close-not-merge/);
  assert.match(sharedRules, /overtake-author-unavailable/);
  assert.match(sharedRules, /overtake-maintainer-push-rights/);
});

test("SKILL route table lists supersede and overtake", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /references\/supersede-pr\.md/);
  assert.match(skill, /references\/overtake-pr\.md/);
});
