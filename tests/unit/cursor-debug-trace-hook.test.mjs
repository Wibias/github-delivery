import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCursorDebugTraceHook } from "../../scripts/cursor-debug-trace-hook.mjs";

test("Cursor debug hook is inert unless tracing is explicitly enabled", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-cursor-hook-off-"));
  const result = runCursorDebugTraceHook({
    rawInput: JSON.stringify({
      hook_event_name: "afterAgentThought",
      conversation_id: "conversation-off",
      generation_id: "generation-off",
      text: "must not persist",
    }),
    env: {},
    stateDir,
    stderr: { write() {} },
  });
  assert.equal(result.recorded, false);
  assert.deepEqual(readdirSync(stateDir), []);
});

test("Cursor IDE hooks append one sanitized provider trace per conversation", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-cursor-hook-on-"));
  const env = { GITHUB_DELIVERY_DEBUG_TRACE: "1" };
  const stderr = { write() {} };

  const thought = runCursorDebugTraceHook({
    rawInput: JSON.stringify({
      hook_event_name: "afterAgentThought",
      conversation_id: "conversation-one",
      generation_id: "generation-one",
      text: "Visible Cursor thought.",
      user_email: "private@example.com",
      transcript_path: "C:/Users/private/transcript.jsonl",
    }),
    env,
    stateDir,
    stderr,
  });
  const tool = runCursorDebugTraceHook({
    rawInput: JSON.stringify({
      hook_event_name: "preToolUse",
      conversation_id: "conversation-one",
      generation_id: "generation-one",
      tool_call_id: "tool-one",
      tool_name: "Shell",
      tool_input: { command: "type C:/private/token.txt" },
    }),
    env,
    stateDir,
    stderr,
  });

  assert.equal(thought.recorded, true);
  assert.equal(tool.recorded, true);
  assert.equal(thought.path, tool.path);
  const persisted = readFileSync(thought.path, "utf8");
  assert.match(persisted, /"provider":"cursor"/);
  assert.match(persisted, /Visible Cursor thought/);
  assert.match(persisted, /"itemType":"Shell"/);
  assert.doesNotMatch(persisted, /private@example|transcript\.jsonl|token\.txt|tool_input/);
});
