import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAgentDebugTraceRecorder,
  debugTraceEnabled,
} from "../../scripts/lib/agent-debug-trace.mjs";
import {
  buildGrokDebugTraceArgs,
  normalizeGrokDebugTraceEvent,
} from "../../scripts/lib/grok-debug-trace.mjs";
import {
  buildCursorDebugTraceArgs,
  normalizeCursorCliDebugTraceEvent,
  normalizeCursorHookDebugTraceEvent,
} from "../../scripts/lib/cursor-debug-trace.mjs";

test("agent debug tracing remains explicit opt-in and provider-tagged", () => {
  assert.equal(debugTraceEnabled({}), false);
  assert.equal(debugTraceEnabled({ GITHUB_DELIVERY_DEBUG_TRACE: "0" }), false);
  assert.equal(debugTraceEnabled({ GITHUB_DELIVERY_DEBUG_TRACE: "1" }), true);
  assert.equal(debugTraceEnabled({ GITHUB_DELIVERY_DEBUG_TRACE: "true" }), true);

  const stateDir = mkdtempSync(join(tmpdir(), "gd-agent-debug-trace-"));
  const disabled = createAgentDebugTraceRecorder({ env: {}, stateDir, provider: "grok" });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.path, null);
  disabled.record({ type: "reasoning_summary_delta", text: "do not persist" });
  disabled.close();
  assert.deepEqual(readdirSync(stateDir), []);

  const enabled = createAgentDebugTraceRecorder({
    env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
    stateDir,
    provider: "grok",
    now: () => new Date("2026-09-07T11:00:00.000Z"),
    pid: 147,
  });
  enabled.record({ type: "reasoning_summary_delta", text: "synthetic diagnostic summary" });
  enabled.close();

  assert.match(enabled.path, /grok-/);
  const persisted = readFileSync(enabled.path, "utf8");
  assert.match(persisted, /"provider":"grok"/);
  assert.match(persisted, /synthetic diagnostic summary/);
  assert.equal(JSON.parse(persisted.trim()).timestamp, "2026-09-07T11:00:00.000Z");
});

test("Grok normalization drops thoughts and keeps sanitized legacy tool lifecycle", () => {
  const thought = normalizeGrokDebugTraceEvent({
    type: "thought",
    data: "Inspecting the controller checkpoint before retrying.",
  });
  assert.deepEqual(thought, []);

  const [started] = normalizeGrokDebugTraceEvent({
    type: "tool_call",
    toolCallId: "call-secret",
    toolName: "read_file",
    kind: "read",
    status: "in_progress",
    rawInput: { path: "C:/Users/private/secrets.txt", token: "super-secret" },
  });
  assert.equal(started.provider, "grok");
  assert.equal(started.type, "item_started");
  assert.equal(started.itemId, "call-secret");
  assert.equal(started.itemType, "read_file");
  assert.doesNotMatch(JSON.stringify(started), /super-secret|secrets\.txt|rawInput/);

  for (const status of [null, "pending", "in_progress"]) {
    assert.deepEqual(
      normalizeGrokDebugTraceEvent({
        type: "tool_call_update",
        toolCallId: "call-secret",
        status,
        rawOutput: { content: "private-progress" },
      }),
      [],
      `non-terminal Grok tool update must not complete the item: ${status}`,
    );
  }

  const [completed] = normalizeGrokDebugTraceEvent({
    type: "tool_call_update",
    toolCallId: "call-secret",
    status: "completed",
    rawOutput: { content: "private-result" },
  });
  assert.equal(completed.type, "item_completed");
  assert.equal(completed.itemId, "call-secret");
  assert.doesNotMatch(JSON.stringify(completed), /private-result|rawOutput/);

  for (const status of ["failed", "cancelled"]) {
    const [terminal] = normalizeGrokDebugTraceEvent({
      type: "tool_call_update",
      toolCallId: "call-secret",
      status,
      rawOutput: { content: "private-terminal-result" },
    });
    assert.equal(terminal.type, "item_completed");
    assert.equal(terminal.itemId, "call-secret");
    assert.doesNotMatch(JSON.stringify(terminal), /private-terminal-result|rawOutput/);
  }

  const [ended] = normalizeGrokDebugTraceEvent({
    type: "end",
    sessionId: "grok-session",
    requestId: "request-private",
    usage: { input_tokens: 999 },
  });
  assert.deepEqual(ended, {
    provider: "grok",
    type: "turn_completed",
    threadId: "grok-session",
  });
});

test("Grok trace wrapper owns message stream output but only for headless invocations", () => {
  assert.deepEqual(buildGrokDebugTraceArgs(["-p", "inspect this repo"]), [
    "-p",
    "inspect this repo",
    "--output-format",
    "streaming-messages-json",
  ]);
  assert.throws(() => buildGrokDebugTraceArgs([]), /headless/i);
  assert.throws(
    () => buildGrokDebugTraceArgs(["-p", "x", "--output-format", "plain"]),
    /owns --output-format/i,
  );
});

test("Cursor CLI stream-json captures thinking and sanitized tool lifecycle", () => {
  const thinking = normalizeCursorCliDebugTraceEvent({
    type: "thinking",
    subtype: "delta",
    text: "Checking whether the route has already been selected.",
    session_id: "cursor-session",
    timestamp_ms: 1,
  });
  assert.deepEqual(thinking, {
    provider: "cursor",
    type: "reasoning_summary_delta",
    threadId: "cursor-session",
    text: "Checking whether the route has already been selected.",
  });

  const started = normalizeCursorCliDebugTraceEvent({
    type: "tool_call",
    subtype: "started",
    call_id: "cursor-call",
    tool_name: "shellToolCall",
    args: { command: "cat C:/private/token.txt" },
  });
  assert.equal(started.provider, "cursor");
  assert.equal(started.type, "item_started");
  assert.equal(started.itemId, "cursor-call");
  assert.equal(started.itemType, "shellToolCall");
  assert.doesNotMatch(JSON.stringify(started), /private|token\.txt|args/);

  const completed = normalizeCursorCliDebugTraceEvent({
    type: "tool_call",
    subtype: "completed",
    call_id: "cursor-call",
    tool_name: "shellToolCall",
    result: "super-secret-output",
  });
  assert.equal(completed.type, "item_completed");
  assert.doesNotMatch(JSON.stringify(completed), /super-secret-output|result/);
});

test("Cursor trace wrapper owns print stream-json flags", () => {
  assert.deepEqual(buildCursorDebugTraceArgs(["inspect this repo"]), [
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "inspect this repo",
  ]);
  assert.throws(
    () => buildCursorDebugTraceArgs(["--output-format", "text", "inspect"]),
    /owns --output-format/i,
  );
});

test("Cursor IDE hooks keep afterAgentThought text but drop sensitive hook payloads", () => {
  const thought = normalizeCursorHookDebugTraceEvent({
    conversation_id: "cursor-conversation",
    generation_id: "cursor-generation",
    text: "The current workflow checkpoint is stale; I need to bind the current head.",
    duration_ms: 1200,
    model: "default",
    hook_event_name: "afterAgentThought",
    user_email: "private@example.com",
    transcript_path: "C:/Users/private/.cursor/transcript.jsonl",
    workspace_roots: ["C:/Users/private/repo"],
  });
  assert.deepEqual(thought, {
    provider: "cursor",
    type: "reasoning_summary_delta",
    threadId: "cursor-conversation",
    turnId: "cursor-generation",
    text: "The current workflow checkpoint is stale; I need to bind the current head.",
  });
  assert.doesNotMatch(
    JSON.stringify(thought),
    /private@example|transcript|workspace_roots|C:\/Users\/private/,
  );

  const started = normalizeCursorHookDebugTraceEvent({
    conversation_id: "cursor-conversation",
    generation_id: "cursor-generation",
    hook_event_name: "preToolUse",
    tool_name: "Shell",
    tool_call_id: "cursor-hook-call",
    tool_input: { command: "type C:/private/token.txt" },
  });
  assert.equal(started.type, "item_started");
  assert.equal(started.itemType, "Shell");
  assert.equal(started.itemId, "cursor-hook-call");
  assert.doesNotMatch(JSON.stringify(started), /private|token\.txt|tool_input/);
});
