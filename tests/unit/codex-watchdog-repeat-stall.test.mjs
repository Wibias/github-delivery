import assert from "node:assert/strict";
import test from "node:test";

import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";
import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

function stop(message, state = {}) {
  return evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "deepseek-repeat-session",
      turn_id: "deepseek-repeat-turn",
      model: "cline-pass/deepseek-v4flash",
      last_assistant_message: message,
    },
    state,
  );
}

test("a second narration stall in one turn hard-stops after an earlier recovery reached a tool boundary", () => {
  const first = stop("Let me read that region of the file.\n".repeat(4));
  assert.equal(first.output.decision, "block");
  assert.match(first.output.reason, /recovery 1\/3/i);

  const toolBoundary = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "deepseek-repeat-session",
      turn_id: "deepseek-repeat-turn",
      model: "cline-pass/deepseek-v4flash",
      tool_name: "exec_command",
      tool_input: { cmd: "Get-Content popup.js" },
    },
    first.state,
  );
  assert.equal(toolBoundary.output, null);
  assert.equal(toolBoundary.state.narrationRecoveryAttempts, 0);

  const repeated = stop("Fixing now.\nApplying now.\nRunning now.\nEmitting now.\n", toolBoundary.state);
  assert.equal(repeated.output.continue, false);
  assert.equal(repeated.output.stopReason, "repeated_no_progress_stall_after_recovery");
  assert.match(repeated.output.systemMessage, /second no-progress narration stall/i);
});

test("default stream watchdog interrupts after four distinct imminent-tool clauses", () => {
  const router = createAppServerWatchdogRouter({
    internalRequestIdPrefix: "gd-repeat-stall",
  });
  const emit = (delta) => router.onServerMessage({
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "deepseek-repeat-thread",
      turnId: "deepseek-repeat-turn",
      itemId: "reasoning",
      delta,
    },
  });

  assert.equal(emit("Fixing now.\n").internalRequests.length, 0);
  assert.equal(emit("Running the patch.\n").internalRequests.length, 0);
  assert.equal(emit("Executing the edit.\n").internalRequests.length, 0);
  const tripped = emit("Emitting the tool call.\n");
  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
});

test("default stream watchdog caps no-progress output near two thousand generated tokens", () => {
  const router = createAppServerWatchdogRouter({
    internalRequestIdPrefix: "gd-repeat-token-budget",
  });
  const usage = (outputTokens) => router.onServerMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "deepseek-token-thread",
      turnId: "deepseek-token-turn",
      tokenUsage: {
        total: { totalTokens: 100_000 + outputTokens, outputTokens },
        last: { totalTokens: outputTokens, outputTokens },
      },
    },
  });

  assert.equal(usage(100).internalRequests.length, 0);
  assert.equal(usage(2_147).internalRequests.length, 0);
  const tripped = usage(2_149);
  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
});
