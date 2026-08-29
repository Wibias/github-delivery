import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

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

test("Stop ends active recovery when the corrective continuation reports a terminal disposition", () => {
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
