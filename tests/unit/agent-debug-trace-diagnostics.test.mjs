import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAgentDebugTraceRecorder } from "../../scripts/lib/agent-debug-trace.mjs";
import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";
import {
  normalizeGrokDebugTraceEvent,
} from "../../scripts/lib/grok-debug-trace.mjs";
import {
  normalizeCursorCliDebugTraceEvent,
  normalizeCursorHookDebugTraceEvent,
} from "../../scripts/lib/cursor-debug-trace.mjs";

function traceEvents(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("stream recorder coalesces adjacent reasoning deltas with the same identity", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-trace-coalesce-"));
  try {
    const recorder = createAgentDebugTraceRecorder({
      provider: "grok",
      env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
      stateDir,
      now: () => new Date("2026-09-09T05:00:00.000Z"),
      pid: 437,
    });
    recorder.record({ type: "reasoning_summary_delta", threadId: "thread-1", turnId: "turn-1", itemId: "reasoning-1", text: "Inspect " });
    recorder.record({ type: "reasoning_summary_delta", threadId: "thread-1", turnId: "turn-1", itemId: "reasoning-1", text: "the controller " });
    recorder.record({ type: "reasoning_summary_delta", threadId: "thread-1", turnId: "turn-1", itemId: "reasoning-1", text: "once." });
    recorder.record({ type: "item_started", threadId: "thread-1", turnId: "turn-1", itemId: "call-1", itemType: "read_file" });
    recorder.close();

    const events = traceEvents(recorder.path);
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "reasoning_summary_delta");
    assert.equal(events[0].text, "Inspect the controller once.");
    assert.equal(events[0].deltaCount, 3);
    assert.equal(events[1].type, "item_started");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("reasoning coalescing stops at an identity boundary", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-trace-boundary-"));
  try {
    const recorder = createAgentDebugTraceRecorder({
      provider: "cursor",
      env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
      stateDir,
      now: () => new Date("2026-09-09T05:00:00.000Z"),
      pid: 438,
    });
    recorder.record({ type: "reasoning_summary_delta", turnId: "a", text: "first" });
    recorder.record({ type: "reasoning_summary_delta", turnId: "b", text: "second" });
    recorder.close();

    const events = traceEvents(recorder.path);
    assert.deepEqual(events.map((event) => event.text), ["first", "second"]);
    assert.deepEqual(events.map((event) => event.deltaCount), [1, 1]);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("Grok terminal tool updates expose only safe outcome duration and error metadata", () => {
  const succeeded = normalizeGrokDebugTraceEvent({
    type: "tool_call_update",
    toolCallId: "call-1",
    toolName: "shell",
    status: "completed",
    duration_ms: 125,
    rawOutput: { secret: "do-not-record" },
  });
  assert.equal(succeeded.outcome, "succeeded");
  assert.equal(succeeded.durationMs, 125);
  assert.equal(succeeded.errorKind, undefined);

  const failed = normalizeGrokDebugTraceEvent({
    type: "tool_call_update",
    toolCallId: "call-2",
    toolName: "shell",
    status: "failed",
    durationMs: 330,
    error: { message: "token=private", stack: "C:/private/path" },
  });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.durationMs, 330);
  assert.equal(failed.errorKind, "tool_failed");
  assert.doesNotMatch(JSON.stringify(failed), /token=private|C:\/private|rawOutput|stack/);
});

test("Cursor terminal events expose safe outcome duration and failure class", () => {
  const completed = normalizeCursorCliDebugTraceEvent({
    type: "tool_call",
    subtype: "completed",
    call_id: "call-1",
    tool_name: "Shell",
    duration_ms: 45,
    result: "private output",
  });
  assert.equal(completed.outcome, "succeeded");
  assert.equal(completed.durationMs, 45);
  assert.doesNotMatch(JSON.stringify(completed), /private output/);

  const failed = normalizeCursorHookDebugTraceEvent({
    hook_event_name: "postToolUseFailure",
    tool_call_id: "call-2",
    tool_name: "Shell",
    duration_ms: 90,
    error: "private failure text",
  });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.durationMs, 90);
  assert.equal(failed.errorKind, "tool_failed");
  assert.doesNotMatch(JSON.stringify(failed), /private failure text/);
});

test("Codex item completion exposes bounded outcome and duration without payloads", () => {
  const trace = [];
  const router = createAppServerWatchdogRouter({ onDebugTrace: (event) => trace.push(event) });
  router.onServerMessage({
    method: "item/completed",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "call-1",
        type: "commandExecution",
        status: "failed",
        durationMs: 77,
        error: { message: "private token", stack: "C:/private/path" },
        output: "private output",
      },
    },
  });

  assert.equal(trace.length, 1);
  assert.equal(trace[0].type, "item_completed");
  assert.equal(trace[0].outcome, "failed");
  assert.equal(trace[0].durationMs, 77);
  assert.equal(trace[0].errorKind, "tool_failed");
  assert.doesNotMatch(JSON.stringify(trace[0]), /private token|private output|C:\/private/);
});

test("recorder persists only allowlisted completion diagnostics", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-trace-sanitize-"));
  try {
    const recorder = createAgentDebugTraceRecorder({
      provider: "grok",
      env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
      stateDir,
      now: () => new Date("2026-09-09T05:00:00.000Z"),
      pid: 439,
    });
    recorder.record({
      type: "item_completed",
      itemId: "call-1",
      itemType: "shell",
      outcome: "failed",
      durationMs: 101,
      errorKind: "tool_failed",
      errorMessage: "secret error body",
      rawOutput: "secret output",
    });
    recorder.close();

    const [event] = traceEvents(recorder.path);
    assert.equal(event.outcome, "failed");
    assert.equal(event.durationMs, 101);
    assert.equal(event.errorKind, "tool_failed");
    assert.doesNotMatch(JSON.stringify(event), /secret error body|secret output|errorMessage|rawOutput/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
