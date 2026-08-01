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

test("mutation mode reference keeps autonomous human replies constrained", () => {
  const reference = read("references/mutation-modes.md");
  assert.match(reference, /Reply to a human thread/);
  assert.match(reference, /exact text required \| exact text required \| exact text required/);
  assert.match(reference, /profile is an upper bound, not a waiver/);
});

test("gate helper invocation carries the active mutation mode", () => {
  const reference = read("references/gate-helpers.md");
  assert.match(reference, /ship-gate\.mjs[\s\S]*--mutation-mode read-only/);
  assert.match(reference, /mutation-policy\.mjs/);
});
