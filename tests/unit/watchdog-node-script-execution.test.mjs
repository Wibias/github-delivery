import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

function runEvidence(state, command, response, now, options) {
  const pre = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    },
    state,
    { now, ...options },
  );
  assert.equal(pre.output?.decision, undefined, pre.output?.reason);
  return evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: response,
    },
    pre.state,
    { now: now + 1, ...options },
  ).state;
}

test("successful direct Node reproducer resets the evidence streak before narrow follow-up inspection", () => {
  const options = { evidenceSoftLimit: 2, evidenceHardLimit: 3 };
  let state = {};

  state = runEvidence(
    state,
    "Get-Content src/a.mjs",
    "export const a = 1;",
    1_000,
    options,
  );
  state = runEvidence(
    state,
    "Get-Content src/b.mjs",
    "export const b = 1;",
    2_000,
    options,
  );

  const command = "node collect-ft10-evidence.mjs --rows=33";
  const preExecution = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    },
    state,
    { now: 2_500, ...options },
  );
  assert.equal(preExecution.output?.decision, undefined, preExecution.output?.reason);

  const postExecution = evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: { success: true, status: "completed" },
    },
    preExecution.state,
    { now: 2_501, ...options },
  );

  assert.equal(postExecution.state.watchdog.consecutiveEvidenceAttempts, 0);

  const followup = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "Get-Content src/c.mjs" },
    },
    postExecution.state,
    { now: 3_000, ...options },
  );
  assert.equal(followup.output?.decision, undefined, followup.output?.reason);
});
