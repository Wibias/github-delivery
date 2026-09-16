import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

test("Stop does not treat descriptive Running clauses as a selected next tool action", () => {
  const report = [
    "I reran the scanner independently and the authority suite is green.",
    "Running the candidate scanner with the historical four-entry registry fails closed with the expected retained-path error.",
    "My fresh candidate scans are identical to the recorded artifacts.",
    "Running with no registry changed no class, so the registry adds dispositions only.",
    "I made no edits, commits, or pull requests.",
  ].join("\n");

  const result = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "incident-2026-09-16",
      turn_id: "turn-1",
      stop_hook_active: false,
      last_assistant_message: report,
    },
    {},
  );

  assert.equal(result.output, null);
  assert.equal(result.state.narrationRecoveryAttempts, 0);
  // The broad stream detector intentionally still sees these phrases; hook-mode
  // stop recovery must not equate that signal with an explicit action commitment.
  assert.equal(result.state.watchdog.toolEmissionIntentCount, 2);
});

test("Stop still recovers when the assistant explicitly commits to a tool action", () => {
  const result = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      session_id: "explicit-tool-commitment",
      turn_id: "turn-1",
      stop_hook_active: false,
      last_assistant_message: "I will run the canonical gate now.",
    },
    {},
  );

  assert.equal(result.output?.decision, "block");
  assert.match(result.output?.reason || "", /recovery 1\/3/i);
  assert.equal(result.state.narrationRecoveryAttempts, 1);
});
