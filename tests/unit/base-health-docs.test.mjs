import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("skill routes red checks through base health classification", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /use the `baseHealth` component/);
  assert.match(skill, /separate_follow_up/);
  assert.match(skill, /unknown origin is a hard evidence stop/);
  assert.doesNotMatch(
    skill,
    /required CI red is still in scope to fix.*introduced elsewhere/i,
  );
});

test("base health reference separates merge blocking from implementation scope", () => {
  const reference = read("references/base-health.md");
  assert.match(reference, /sharedFailures/);
  assert.match(reference, /does not automatically expand the PR implementation scope/);
  assert.match(reference, /green PR head does not require base comparison evidence/);
});
