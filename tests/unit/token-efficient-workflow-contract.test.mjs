import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../../references/create-pr-for-issue.md", import.meta.url),
  "utf8",
);
const mutationPolicy = readFileSync(
  new URL("../../references/policy/mutation.md", import.meta.url),
  "utf8",
);
const skill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");

function canonicalBytes(value) {
  return Buffer.byteLength(value.replace(/\r\n?/g, "\n"), "utf8");
}

test("issue-to-PR workflow keeps safety gates while staying compact", () => {
  for (const pattern of [
    /Need-to-fix preflight/i,
    /every comment|full issue thread/i,
    /Screenshot gate/i,
    /Implement locally/i,
    /Pre-open bug \+ security gate/i,
    /canonical PR/i,
    /Fixes #N/i,
    /assign/i,
    /merge-ready/i,
    /Do not merge/i,
  ]) {
    assert.match(workflow, pattern);
  }
  const workflowBytes = canonicalBytes(workflow);
  assert.ok(workflowBytes < 9000, `workflow bytes: ${workflowBytes}`);
  assert.doesNotMatch(workflow, /Plan, authorize, then execute/i);
  assert.doesNotMatch(workflow, /```json[\s\S]*?"action"/i);
});

test("routine mutation docs make github-mutate own authority choreography", () => {
  assert.match(mutationPolicy, /github-mutate\.mjs --request .* --execute/i);
  assert.match(mutationPolicy, /authority acquisition/i);
  assert.match(skill, /Do not invoke `scripts\/github-authorize\.mjs` separately/i);
});
