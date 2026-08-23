import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("skill makes ship-gate authoritative for readiness and watch idle", () => {
  const skill = read("SKILL.md");
  assert.match(skill, /Watch MUST run scripts\/ship-gate\.mjs every wake/);
  assert.match(skill, /Authoritative gate:.*scripts\/ship-gate\.mjs/s);
  assert.match(skill, /final `ship-gate\.mjs` result must be `ready`/);
  assert.doesNotMatch(skill, /Watch MUST run scripts\/watch-wake-gate\.mjs/);
});

test("gate helper reference leads with one decision and demotes component helpers", () => {
  const reference = read("references/gate-helpers.md");
  const authoritative = reference.indexOf("## Authoritative ship decision");
  const diagnostics = reference.indexOf("## Focused diagnostics");
  assert.ok(authoritative >= 0);
  assert.ok(diagnostics > authoritative);
  assert.match(reference, /No individual helper may overrule the final decision/);
  assert.match(reference, /exit `2`, `decision: "unknown"`/);
  assert.match(reference, /An unrelated later commit does not clear feedback/);
});

test("merge documentation cannot waive required current-head review evidence", () => {
  const merge = read("references/merge-pr.md");
  assert.match(
    merge,
    /Missing review evidence is not waivable inside the merge workflow/,
  );
  assert.doesNotMatch(
    merge,
    /explicit merge-anyway instruction|merge-anyway instruction/i,
  );
});

test("ship-gate snapshot retries rate-limited read-only GitHub calls", () => {
  const source = read("scripts/ship-gate-snapshot.mjs");
  assert.match(source, /runGitHubCommandWithRetry/);
  assert.match(source, /from "\.\/lib\/github-retry\.mjs"/);
  assert.match(source, /runGitHubCommandWithRetry\("gh", args,/);
});
