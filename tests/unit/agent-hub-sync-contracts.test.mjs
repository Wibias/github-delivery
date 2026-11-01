import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function preSearch(index) {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "files__search",
    tool_input: {
      search_query: [{ q: `distinct-query-${index}` }],
    },
  };
}

test("agent-hub native Codex memory drift guard is packaged", () => {
  const modulePath = join(ROOT, "scripts/lib/codex-native-memory-drift.mjs");
  assert.equal(existsSync(modulePath), true, "expected native Codex memory drift guard");

  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.files.includes("scripts/lib/codex-native-memory-drift.mjs"));
});

test("default Codex evidence budget allows 50 distinct evidence reads", () => {
  let state = {};
  const blocks = [];
  const warnings = [];

  for (let index = 1; index <= 50; index += 1) {
    const result = evaluateCodexHook(preSearch(index), state);
    state = result.state;
    if (result.output?.decision === "block") blocks.push({ index, reason: result.output.reason });
    if (result.output?.hookSpecificOutput?.additionalContext) warnings.push(index);
  }

  assert.deepEqual(blocks, []);
  assert.equal(state.watchdog.consecutiveEvidenceAttempts, 50);
  assert.ok(warnings.length >= 1, "expected a soft-limit warning before the hard limit");
});

test("larger default evidence budget still blocks a duplicate read", () => {
  const first = evaluateCodexHook(preSearch(1), {});
  assert.notEqual(first.output?.decision, "block");

  const duplicate = evaluateCodexHook(preSearch(1), first.state);
  assert.equal(duplicate.output?.decision, "block");
  assert.match(duplicate.output?.reason || "", /Duplicate read blocked/i);
});

test("agent-hub follow-up guidance is present", () => {
  assert.match(read("references/change-execution.md"), /Remove shared state before serializing it/);
  assert.match(read("references/regression-first.md"), /forced miss/i);
  assert.match(read("references/pr-description.md"), /compact structural view/i);
  assert.match(read("references/policy/reviews.md"), /hot path/i);
  assert.match(read("references/semantic-propagation-review.md"), /generated/i);
  assert.match(read("references/git-workflow.md"), /logical effect/i);
  assert.match(read("references/prose-quality.md"), /commit message/i);
});
