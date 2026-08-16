import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCodexTool,
  evaluateCodexHook,
} from "../../scripts/lib/codex-watchdog-hook.mjs";

test("Codex hook classifies CI status polling as a volatile read", () => {
  assert.deepEqual(
    classifyCodexTool("Bash", { command: "gh pr checks 1397 --repo lidge-jun/opencodex" }),
    { kind: "read", volatility: "volatile" },
  );
});

test("PreToolUse blocks an exact stable duplicate read on unchanged state", () => {
  const input = {
    hook_event_name: "PreToolUse",
    session_id: "s1",
    turn_id: "t1",
    tool_name: "mcp__github__fetch_file",
    tool_input: { repo: "o/r", path: "README.md", ref: "abc" },
  };

  const first = evaluateCodexHook(input, {}, { now: 1_000 });
  assert.equal(first.output, null);

  const second = evaluateCodexHook(input, first.state, { now: 2_000 });
  assert.equal(second.output.decision, "block");
  assert.match(second.output.reason, /reuse|unchanged/i);
});

test("PreToolUse rate-limits repeated manual CI polling", () => {
  const input = {
    hook_event_name: "PreToolUse",
    session_id: "s1",
    turn_id: "t1",
    tool_name: "Bash",
    tool_input: { command: "gh pr checks 1397 --repo lidge-jun/opencodex" },
  };

  const first = evaluateCodexHook(input, {}, { now: 1_000 });
  const second = evaluateCodexHook(input, first.state, { now: 5_000 });
  assert.equal(second.output.decision, "block");
  assert.match(second.output.reason, /ci-wait|poll/i);

  const later = evaluateCodexHook(input, second.state, { now: 31_001 });
  assert.equal(later.output, null);
});

test("PreToolUse rejects an oversized subagent brief instead of duplicating context", () => {
  const result = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "Agent",
      tool_input: { prompt: "specialist context ".repeat(600) },
    },
    {},
    { maxSubagentInputChars: 4_000 },
  );
  assert.equal(result.output.decision, "block");
  assert.match(result.output.reason, /subagent|brief/i);
  assert.match(result.output.reason, /reference|compact/i);
});

test("PreToolUse allows a focused subagent brief", () => {
  const result = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "Agent",
      tool_input: { prompt: "Review src/auth.ts for concrete auth regressions only." },
    },
    {},
    { maxSubagentInputChars: 4_000 },
  );
  assert.equal(result.output, null);
});

test("PostToolUse preserves oversized model-facing output", () => {
  const toolResponse = Array.from(
    { length: 300 },
    (_, index) => `ordinary output ${index}`,
  ).join("\n");
  const result = evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "Bash",
      tool_input: { command: "gh run view 123 --log-failed" },
      tool_response: toolResponse,
    },
    {},
    { maxToolOutputChars: 900 },
  );

  assert.equal(result.output, null);
});

test("Stop keeps narration recovery active until a real tool boundary", () => {
  const stalled = "Let me read the reference.\n".repeat(4);
  const first = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: false,
      last_assistant_message: stalled,
    },
    {},
  );
  assert.equal(first.output.decision, "block");
  assert.match(first.output.reason, /recovery 1\/3/i);
  assert.equal(first.state.narrationRecoveryAttempts, 1);

  const second = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: true,
      last_assistant_message: "Reading diagnostics now.",
    },
    first.state,
  );
  assert.equal(second.output.decision, "block");
  assert.match(second.output.reason, /recovery 2\/3/i);
  assert.equal(second.state.narrationRecoveryAttempts, 2);

  const toolBoundary = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "future_special_tool",
      tool_input: { path: "diagnostics.json" },
    },
    second.state,
  );
  assert.equal(toolBoundary.output, null);
  assert.equal(toolBoundary.state.narrationRecoveryAttempts, 0);
  assert.equal(toolBoundary.state.watchdog.toolEmissionIntentCount, 0);

  const completed = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: false,
      last_assistant_message: "The requested inspection completed successfully.",
    },
    toolBoundary.state,
  );
  assert.equal(completed.output, null);
});

test("Stop hard-stops only after the bounded narration recovery is exhausted", () => {
  const options = { maxNarrationRecoveryAttempts: 2 };
  const stalled = "Let me inspect the diagnostics.\n".repeat(4);
  const first = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      last_assistant_message: stalled,
    },
    {},
    options,
  );
  assert.equal(first.output.decision, "block");
  assert.match(first.output.reason, /recovery 1\/2/i);

  const second = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: true,
      last_assistant_message: "Reading diagnostics now.",
    },
    first.state,
    options,
  );
  assert.equal(second.output.decision, "block");
  assert.match(second.output.reason, /recovery 2\/2/i);

  const exhausted = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: true,
      last_assistant_message: "I'll read the relevant diagnostic files.",
    },
    second.state,
    options,
  );
  assert.equal(exhausted.output.continue, false);
  assert.equal(exhausted.output.stopReason, "no_progress_stall_after_bounded_recovery");
  assert.match(exhausted.output.systemMessage, /2 corrective continuations/i);
});

test("Stop hard-stops a repeated protocol-artifact stall without a corrective continuation", () => {
  const stalled = [
    "Let me apply the patch.",
    "grid",
    "Let me execute it.",
    "<grid></grid>",
    "grid",
  ].join("\n");
  const result = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: false,
      last_assistant_message: stalled,
    },
    {},
  );

  assert.equal(result.output.continue, false);
  assert.equal(result.output.stopReason, "tool_protocol_emission_stall");
  assert.equal(result.output.decision, undefined);
});

test("SubagentStop uses the same bounded recovery contract", () => {
  const options = { maxNarrationRecoveryAttempts: 2 };
  const stalled = "Let me inspect the reference.\n".repeat(4);
  const first = evaluateCodexHook(
    {
      hook_event_name: "SubagentStop",
      session_id: "s1",
      turn_id: "t1",
      agent_id: "a1",
      agent_type: "explorer",
      stop_hook_active: false,
      last_assistant_message: stalled,
    },
    {},
    options,
  );
  assert.equal(first.output.decision, "block");
  assert.match(first.output.reason, /recovery 1\/2/i);

  const second = evaluateCodexHook(
    {
      hook_event_name: "SubagentStop",
      session_id: "s1",
      turn_id: "t1",
      agent_id: "a1",
      agent_type: "explorer",
      stop_hook_active: true,
      last_assistant_message: "Reading the reference now.",
    },
    first.state,
    options,
  );
  assert.equal(second.output.decision, "block");
  assert.match(second.output.reason, /recovery 2\/2/i);

  const exhausted = evaluateCodexHook(
    {
      hook_event_name: "SubagentStop",
      session_id: "s1",
      turn_id: "t1",
      agent_id: "a1",
      agent_type: "explorer",
      stop_hook_active: true,
      last_assistant_message: "I'll inspect the reference now.",
    },
    second.state,
    options,
  );
  assert.equal(exhausted.output.continue, false);
  assert.equal(exhausted.output.stopReason, "no_progress_stall_after_bounded_recovery");
});

test("unknown tools are never denied by economy classification", () => {
  const result = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s1",
      turn_id: "t1",
      tool_name: "future_special_tool",
      tool_input: { anything: true },
    },
    {},
  );
  assert.equal(result.output, null);
});
