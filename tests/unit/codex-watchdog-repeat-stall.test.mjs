import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCodexWatchdogHook } from "../../scripts/codex-watchdog-hook.mjs";
import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";

const MODEL = "cline-pass/deepseek-v4flash";

function hookInput(hook_event_name, extra = {}) {
  return {
    hook_event_name,
    session_id: "deepseek-repeat-session",
    turn_id: "deepseek-repeat-turn",
    model: MODEL,
    ...extra,
  };
}

test("a second narration stall in one turn hard-stops and quarantines after recovery reached a tool boundary", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "gd-repeat-stall-"));
  try {
    const first = runCodexWatchdogHook(
      hookInput("Stop", {
        last_assistant_message: "Let me read that region of the file.\n".repeat(4),
      }),
      { stateRoot },
    );
    assert.equal(first.output.decision, "block");
    assert.match(first.output.reason, /recovery 1\/3/i);
    assert.equal(first.state.narrationRecoveryProbation, true);

    const toolBoundary = runCodexWatchdogHook(
      hookInput("PreToolUse", {
        tool_name: "exec_command",
        tool_input: { cmd: "Get-Content popup.js" },
      }),
      { stateRoot },
    );
    assert.equal(toolBoundary.output, null);
    assert.equal(toolBoundary.state.narrationRecoveryAttempts, 0);
    assert.equal(toolBoundary.state.narrationRecoveryProbation, true);

    const repeated = runCodexWatchdogHook(
      hookInput("Stop", {
        last_assistant_message: [
          "Fixing now.",
          "Running the patch.",
          "Executing the edit.",
          "Emitting the tool call.",
          "Writing the change.",
          "Calling the tool.",
        ].join("\n"),
      }),
      { stateRoot },
    );
    assert.equal(repeated.output.continue, false);
    assert.equal(repeated.output.stopReason, "repeated_no_progress_stall_after_recovery");
    assert.match(repeated.output.systemMessage, /second no-progress narration stall/i);
    assert.equal(repeated.quarantinePersisted, true);

    const quarantined = runCodexWatchdogHook(
      hookInput("UserPromptSubmit", { prompt: "continue" }),
      { stateRoot },
    );
    assert.equal(quarantined.output.decision, "block");
    assert.match(quarantined.output.reason, /repeated no-progress narration/i);
    assert.match(quarantined.output.reason, /change model|new task/i);
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("default stream watchdog retains the six-clause imminent-tool boundary", () => {
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
  assert.equal(emit("Emitting the tool call.\n").internalRequests.length, 0);
  assert.equal(emit("Writing the change.\n").internalRequests.length, 0);
  const tripped = emit("Calling the tool.\n");
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

test("tight action budgets do not replace the larger finalization budget", () => {
  const router = createAppServerWatchdogRouter({
    internalRequestIdPrefix: "gd-repeat-finalization",
  });
  router.onServerMessage({
    method: "turn/plan/updated",
    params: {
      threadId: "deepseek-final-thread",
      turnId: "deepseek-final-turn",
      plan: [{ step: "implement", status: "completed" }],
    },
  });

  const usage = (outputTokens) => router.onServerMessage({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "deepseek-final-thread",
      turnId: "deepseek-final-turn",
      tokenUsage: {
        total: { totalTokens: 100_000 + outputTokens, outputTokens },
        last: { totalTokens: outputTokens, outputTokens },
      },
    },
  });

  assert.equal(usage(100).internalRequests.length, 0);
  assert.equal(usage(3_000).internalRequests.length, 0);
});
