import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAgentDebugTraceRecorder } from "../../scripts/lib/agent-debug-trace.mjs";
import { normalizeGrokDebugTraceEvent } from "../../scripts/lib/grok-debug-trace.mjs";
import {
  analyzeTraceEvents,
  renderTraceAnalysis,
} from "../../scripts/lib/trace-analyze.mjs";

function readEvents(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("real Grok path keys produce target fingerprints without persisting paths", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-trace-real-grok-targets-"));
  try {
    const recorder = createAgentDebugTraceRecorder({
      provider: "grok",
      env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
      stateDir,
      now: () => new Date("2026-11-03T05:48:53.931Z"),
      pid: 12340,
      idSalt: "real-grok-target-test-salt",
    });

    const firstRead = normalizeGrokDebugTraceEvent({
      type: "assistant",
      session_id: "session-1",
      message: {
        id: "turn-1",
        content: [{
          type: "tool_use",
          id: "read-1",
          name: "read_file",
          input: { target_file: "C:/private/repo/src/a.mjs", offset: 0 },
        }],
      },
    }, recorder.diagnostics);
    const secondRead = normalizeGrokDebugTraceEvent({
      type: "assistant",
      session_id: "session-1",
      message: {
        id: "turn-2",
        content: [{
          type: "tool_use",
          id: "read-2",
          name: "read_file",
          input: { target_file: "C:/private/repo/src/a.mjs", offset: 100 },
        }],
      },
    }, recorder.diagnostics);
    const list = normalizeGrokDebugTraceEvent({
      type: "assistant",
      session_id: "session-1",
      message: {
        id: "turn-3",
        content: [{
          type: "tool_use",
          id: "list-1",
          name: "list_dir",
          input: { target_directory: "C:/private/repo/src" },
        }],
      },
    }, recorder.diagnostics);

    for (const event of [...firstRead, ...secondRead, ...list]) recorder.record(event);
    recorder.close();

    const events = readEvents(recorder.path).filter((event) => event.type === "item_started");
    assert.equal(events.length, 3);
    assert.match(events[0].targetFingerprint, /^fp:[a-f0-9]{32}$/);
    assert.equal(events[0].targetFingerprint, events[1].targetFingerprint);
    assert.match(events[2].targetFingerprint, /^fp:[a-f0-9]{32}$/);
    assert.notEqual(events[0].argumentFingerprint, events[1].argumentFingerprint);

    const persisted = JSON.stringify(events);
    assert.doesNotMatch(persisted, /private|repo|src|a\.mjs/i);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("Grok terminal diagnostics classify state change and PR publication without persisting command text", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-trace-real-grok-terminal-"));
  try {
    const recorder = createAgentDebugTraceRecorder({
      provider: "grok",
      env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
      stateDir,
      now: () => new Date("2026-11-03T05:48:53.931Z"),
      pid: 12341,
      idSalt: "real-grok-terminal-test-salt",
    });

    const events = normalizeGrokDebugTraceEvent({
      type: "assistant",
      session_id: "session-1",
      message: {
        id: "turn-1",
        content: [{
          type: "tool_use",
          id: "terminal-1",
          name: "run_terminal_command",
          input: {
            command: "gh pr create --base main --head fix/private-branch --title secret --body secret",
            description: "Open the requested pull request",
          },
        }],
      },
    }, recorder.diagnostics);

    for (const event of events) recorder.record(event);
    recorder.close();

    const [started] = readEvents(recorder.path).filter((event) => event.type === "item_started");
    assert.equal(started.toolEffect, "state-change");
    assert.equal(started.publicationAction, "pr_create");

    const persisted = JSON.stringify(started);
    assert.doesNotMatch(persisted, /gh pr create|private-branch|secret/i);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("trace analyzer uses classified terminal mutations and does not present missing target evidence as zero", () => {
  const base = Date.parse("2026-11-03T05:48:53.000Z");
  const at = (seconds) => new Date(base + seconds * 1000).toISOString();
  const events = [
    { type: "trace_metadata", provider: "grok", timestamp: at(0) },
    { type: "item_started", provider: "grok", timestamp: at(1), itemId: "id:1", itemType: "read_file" },
    { type: "item_completed", provider: "grok", timestamp: at(2), itemId: "id:1", outcome: "succeeded" },
    {
      type: "item_started",
      provider: "grok",
      timestamp: at(10),
      itemId: "id:2",
      itemType: "run_terminal_command",
      toolEffect: "state-change",
      publicationAction: "pr_create",
    },
    { type: "item_completed", provider: "grok", timestamp: at(11), itemId: "id:2", outcome: "succeeded" },
    { type: "item_started", provider: "grok", timestamp: at(20), itemId: "id:3", itemType: "read_file" },
    { type: "item_completed", provider: "grok", timestamp: at(21), itemId: "id:3", outcome: "succeeded" },
  ];

  const analysis = analyzeTraceEvents(events);
  assert.equal(analysis.targetFingerprintCalls, 0);
  assert.equal(analysis.publicationAttempts, 1);
  assert.equal(analysis.postFinalMutation.toolCalls, 1);
  assert.equal(analysis.postFinalMutation.mutations, 0);

  const rendered = renderTraceAnalysis(analysis);
  assert.match(rendered, /Repeated targets\s+n\/a \(no target fingerprints\)/);
  assert.match(rendered, /PR publication attempts\s+1/);
});
