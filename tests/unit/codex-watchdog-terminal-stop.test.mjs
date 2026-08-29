import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

function beginNarrationRecovery() {
  const first = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: false,
      last_assistant_message: "Let me read the reference.\n".repeat(4),
    },
    {},
  );

  assert.equal(first.output.decision, "block");
  assert.match(first.output.reason, /recovery 1\/3/i);
  return first;
}

test("Stop allows a completed final report even when it exceeds the streaming generation budget", () => {
  const report = [
    "# Independent acceptance review",
    "The read-only review is complete.",
    "D144_VERDICT = REJECTED",
    "No further action is authorized.",
    "Evidence follows.",
    "x".repeat(12_500),
  ].join("\n");

  const result = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: false,
      last_assistant_message: report,
    },
    {},
  );

  assert.equal(result.output, null);
  assert.equal(result.state.narrationRecoveryAttempts, 0);
});

test("Stop treats a long completed recommendation as finalization without requiring a magic terminal phrase", () => {
  const report = [
    "# Contract sufficiency analysis",
    "F03_CONTRACT_SUFFICIENT = false",
    "The accepted authority does not define a representation-independent semantic alias predicate.",
    "NEXT_ACTION = AUTHOR_NARROW_AUTHORITY_CORRECTION",
    "STOP after the recommendation.",
    "x".repeat(20_000),
  ].join("\n");

  const result = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s2",
      turn_id: "t2",
      stop_hook_active: false,
      last_assistant_message: report,
    },
    {},
  );

  assert.equal(result.output, null);
  assert.equal(result.state.narrationRecoveryAttempts, 0);
});

test("Stop ends active recovery when the corrective continuation reports a terminal disposition", () => {
  const first = beginNarrationRecovery();

  const terminal = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: true,
      last_assistant_message:
        "No further action is authorized. The read-only review is complete.",
    },
    first.state,
  );

  assert.equal(terminal.output, null);
  assert.equal(terminal.state.narrationRecoveryAttempts, 0);
});

test("Stop ends active recovery when the corrective continuation cannot execute the selected next action", () => {
  const first = beginNarrationRecovery();

  const terminal = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s3",
      turn_id: "t3",
      stop_hook_active: true,
      last_assistant_message:
        "Cannot execute the selected next action: the user explicitly prohibited creating authority and required stopping after the recommendation.",
    },
    first.state,
  );

  assert.equal(terminal.output, null);
  assert.equal(terminal.state.narrationRecoveryAttempts, 0);
});

test("Stop ends active recovery when the corrective continuation reports an explicit authorization blocker", () => {
  const first = beginNarrationRecovery();

  const terminal = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s4",
      turn_id: "t4",
      stop_hook_active: true,
      last_assistant_message:
        "Blocked: authoring the recommended authority correction is explicitly unauthorized by the user.",
    },
    first.state,
  );

  assert.equal(terminal.output, null);
  assert.equal(terminal.state.narrationRecoveryAttempts, 0);
});

test("terminal wording does not end recovery when the same response announces another tool action", () => {
  const first = beginNarrationRecovery();

  const mixed = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: true,
      last_assistant_message:
        "No further action is authorized. Let me read one more reference.",
    },
    first.state,
  );

  assert.equal(mixed.output.decision, "block");
  assert.match(mixed.output.reason, /recovery 2\/3/i);
  assert.equal(mixed.state.narrationRecoveryAttempts, 2);
});

test("a reported blocker does not end recovery when the same response announces another tool action", () => {
  const first = beginNarrationRecovery();

  const mixed = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s5",
      turn_id: "t5",
      stop_hook_active: true,
      last_assistant_message:
        "Cannot execute the selected next action because it is unauthorized. I will read one more reference.",
    },
    first.state,
  );

  assert.equal(mixed.output.decision, "block");
  assert.match(mixed.output.reason, /recovery 2\/3/i);
  assert.equal(mixed.state.narrationRecoveryAttempts, 2);
});

test("terminal wording cannot bypass the completed-answer hard generation bound", () => {
  const report = [
    "# Final report",
    "No further action is authorized.",
    "x".repeat(65_000),
  ].join("\n");

  const result = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s6",
      turn_id: "t6",
      stop_hook_active: false,
      last_assistant_message: report,
    },
    {},
  );

  assert.equal(result.output.decision, "block");
  assert.match(result.output.reason, /recovery 1\/3/i);
});

test("completed-answer allowance does not hide a genuine repeated tool-intent stall", () => {
  const report = `${"Let me read the reference.\n".repeat(4)}${"x".repeat(20_000)}`;

  const result = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s7",
      turn_id: "t7",
      stop_hook_active: false,
      last_assistant_message: report,
    },
    {},
  );

  assert.equal(result.output.decision, "block");
  assert.match(result.output.reason, /recovery 1\/3/i);
});
