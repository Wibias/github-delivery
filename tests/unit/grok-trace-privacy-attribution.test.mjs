import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAgentDebugTraceRecorder } from "../../scripts/lib/agent-debug-trace.mjs";
import {
  buildGrokDebugTraceArgs,
  normalizeGrokDebugTraceEvent,
} from "../../scripts/lib/grok-debug-trace.mjs";

test("Grok tracing uses message streaming so nested-agent identity is available", () => {
  assert.deepEqual(buildGrokDebugTraceArgs(["-p", "inspect"]), [
    "-p",
    "inspect",
    "--output-format",
    "streaming-messages-json",
  ]);
});

test("Grok thinking is never normalized into persisted reasoning text", () => {
  const normalized = normalizeGrokDebugTraceEvent({
    type: "assistant",
    session_id: "session-1",
    parent_tool_use_id: null,
    message: {
      id: "message-1",
      content: [
        { type: "thinking", thinking: "private chain of thought that must not persist" },
      ],
    },
  });

  assert.deepEqual(normalized, []);
  assert.doesNotMatch(JSON.stringify(normalized), /private chain of thought/);
});

test("Grok tool events retain session and nested-parent attribution without raw payloads", () => {
  const normalized = normalizeGrokDebugTraceEvent({
    type: "assistant",
    session_id: "session-1",
    parent_tool_use_id: "spawn-subagent-1",
    message: {
      id: "message-2",
      content: [
        { type: "thinking", thinking: "private nested reasoning" },
        {
          type: "tool_use",
          id: "call-1",
          name: "read_file",
          input: { path: "C:/Users/private/secrets.txt", token: "secret-token" },
        },
      ],
    },
  });

  assert.deepEqual(normalized, [{
    provider: "grok",
    type: "item_started",
    threadId: "session-1",
    turnId: "message-2",
    itemId: "call-1",
    itemType: "read_file",
    parentItemId: "spawn-subagent-1",
  }]);
  assert.doesNotMatch(JSON.stringify(normalized), /private nested reasoning|secrets\.txt|secret-token|input/);
});

test("trace recorder preserves parent item attribution", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-grok-parent-attribution-"));
  const recorder = createAgentDebugTraceRecorder({
    provider: "grok",
    env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
    stateDir,
    now: () => new Date("2026-09-10T00:00:00.000Z"),
    pid: 42,
  });

  recorder.record({
    type: "item_started",
    threadId: "session-1",
    turnId: "message-2",
    itemId: "call-1",
    itemType: "read_file",
    parentItemId: "spawn-subagent-1",
  });
  recorder.close();

  const event = JSON.parse(readFileSync(recorder.path, "utf8").trim());
  assert.equal(event.parentItemId, "spawn-subagent-1");
});
