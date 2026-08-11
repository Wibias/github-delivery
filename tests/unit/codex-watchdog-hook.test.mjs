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

test("PostToolUse replaces only oversized model-facing output with a bounded excerpt", () => {
  const toolResponse = [
    ...Array.from({ length: 300 }, (_, index) => `ordinary output ${index}`),
    "ERROR unsponsored_surface",
    "exit code: 1",
  ].join("\n");
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

  assert.equal(result.output.continue, false);
  assert.match(result.output.stopReason, /tool_output_compacted/);
  assert.match(result.output.stopReason, /ERROR unsponsored_surface/);
  assert.ok(result.output.stopReason.length < 1_200);
});

test("Stop requests one corrective continuation for a narration stall", () => {
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
  assert.match(first.output.reason, /no-progress|tool call|blocker/i);

  const second = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "s1",
      turn_id: "t1",
      stop_hook_active: true,
      last_assistant_message: stalled,
    },
    first.state,
  );
  assert.equal(second.output.continue, false);
  assert.match(second.output.stopReason, /no_progress_stall/);
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
