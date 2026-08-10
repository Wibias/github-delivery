import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { actionNamesWhere } from "../../scripts/lib/mutation-action-registry.mjs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function documentedHighAssuranceActions(reference) {
  const match = reference.match(
    /<!-- high-assurance-actions:start -->([\s\S]*?)<!-- high-assurance-actions:end -->/,
  );
  assert.ok(match, "high-assurance action documentation block is missing");
  return [...match[1].matchAll(/^\s*-\s+`([^`]+)`\s*$/gm)]
    .map((row) => row[1])
    .sort();
}

test("skill defaults to read-only and names every mutation profile", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /Default mutation mode is\s+read-only/);
  for (const mode of ["read-only", "review", "maintainer", "autonomous"]) {
    assert.match(skill, new RegExp(`\\b${mode}\\b`));
  }
  assert.match(skill, /Human replies always require exact-text confirmation/);
});

test("mutation mode reference separates normal policy from optional trusted authority", () => {
  const reference = read("references/mutation-modes.md");
  assert.match(reference, /Mutation mode and trusted-authority protection are separate controls/);
  assert.match(reference, /Reply to a human thread/);
  assert.match(reference, /exact text required; authority policy applies/);
  assert.match(reference, /Publish a full-review verdict/);
  assert.match(reference, /authority policy applies/);
  assert.match(reference, /`authorityMode`/);
  for (const authorityMode of ["off", "high-assurance", "all"]) {
    assert.match(reference, new RegExp(`\\b${authorityMode}\\b`));
  }
  assert.match(reference, /persistent user config defaults to `off`/i);
  assert.match(reference, /`off` means \*\*no Windows Hello \/ trusted-authority prompt\*\*/);
  assert.match(reference, /Direct merge instruction[\s\S]*exact-text confirmation[\s\S]*expected-head checks/i);
  assert.match(reference, /profile is an upper bound, not a waiver/);
  assert.match(reference, /generic `post_comment`[\s\S]*never satisfies merge review evidence/i);
});

test("documented high-assurance actions exactly match the executable registry", () => {
  const reference = read("references/mutation-modes.md");
  const documented = documentedHighAssuranceActions(reference);
  const executable = actionNamesWhere("highAssurance", true).sort();
  assert.deepEqual(documented, executable);
  assert.equal(new Set(documented).size, documented.length, "documented actions must be unique");
});

test("bare full review selects review mode and follows configured authority protection", () => {
  const reference = read("references/mutation-modes.md");
  assert.match(reference, /full review PR #32/);
  assert.match(reference, /full review PR #32[\s\S]*→ `review`/);
  assert.match(reference, /full-review verdict[\s\S]*trusted authority is added when the configured protection mode requires it/i);
  assert.match(reference, /When `authorityMode` is `off`[\s\S]*does not require OS-backed provenance/i);
  assert.match(reference, /reports `trusted:false`/);
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
  assert.match(reference, /router output is authoritative/i);
  assert.match(reference, /Gate invocations must pass the routed mutation mode plus `--workflow`/);
  assert.match(reference, /self-selected mode is a workflow violation/i);
  assert.match(helpers, /verify-verdict-published\.mjs/);
  assert.match(helpers, /--workflow references\/full-review-pr\.md/);
});
