import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const kernel = readFileSync(
  new URL("../../references/policy-kernel.md", import.meta.url),
  "utf8",
);
const mutationPolicy = readFileSync(
  new URL("../../references/policy/mutation.md", import.meta.url),
  "utf8",
);
const skill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");

test("global policy forces bounded forward progress instead of no-op reasoning loops", () => {
  assert.match(kernel, /GD-CORE-008/i);
  assert.match(kernel, /same next action/i);
  assert.match(kernel, /tool call|state change|new evidence/i);
  assert.match(kernel, /execute.*immediately|concrete blocker/i);
  assert.match(kernel, /re-?verify|repeated verification|repeat.*verification/i);
});

test("prepared GitHub writes do not get a second ad-hoc preflight loop", () => {
  assert.match(mutationPolicy, /prepared mutation request/i);
  assert.match(mutationPolicy, /github-mutate\.mjs/i);
  assert.match(mutationPolicy, /do not .*repeat.*preflight|do not .*duplicate.*preflight/i);
  assert.match(skill, /GD-CORE-001 through GD-CORE-009/i);
  assert.match(skill, /bounded progress/i);
});

test("verification economy reuses passing evidence on unchanged code and state", () => {
  assert.match(kernel, /GD-CORE-009/i);
  assert.match(kernel, /reuse.*passing evidence|reuse.*valid evidence/i);
  assert.match(kernel, /overlapping|narrower/i);
  assert.match(kernel, /targeted.*aggregate|aggregate.*targeted/i);
  assert.match(kernel, /failure|failed/i);
  assert.match(kernel, /state.*change|inputs?.*change/i);
  assert.match(skill, /GD-CORE-009/i);
  assert.match(skill, /verification economy|evidence reuse/i);
});

test("deterministic tool calls are executed without micro-narration", () => {
  assert.match(kernel, /do not narrate.*tool calls|execute.*without.*narrat/i);
  assert.match(kernel, /phase change|material.*change|user input/i);
});
