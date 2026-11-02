import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../../scripts/github-delivery-cli.mjs";
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

function captureStream() {
  let value = "";
  return {
    stream: { write(chunk) { value += String(chunk); } },
    text: () => value,
  };
}

test("trace diagnostics fingerprint tool payloads without persisting raw values", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "gd-trace-fingerprint-"));
  try {
    const recorder = createAgentDebugTraceRecorder({
      provider: "grok",
      env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
      stateDir,
      now: () => new Date("2026-11-01T22:11:15.000Z"),
      pid: 13600,
      idSalt: "stable-test-salt",
    });

    assert.equal(typeof recorder.diagnostics?.toolInput, "function");
    assert.equal(typeof recorder.diagnostics?.toolResult, "function");

    const first = normalizeGrokDebugTraceEvent({
      type: "assistant",
      session_id: "session-1",
      message: {
        id: "turn-1",
        content: [{
          type: "tool_use",
          id: "call-1",
          name: "read_file",
          input: { path: "C:/private/repository/secret.js", offset: 0 },
        }],
      },
    }, recorder.diagnostics);
    const second = normalizeGrokDebugTraceEvent({
      type: "assistant",
      session_id: "session-1",
      message: {
        id: "turn-2",
        content: [{
          type: "tool_use",
          id: "call-2",
          name: "read_file",
          input: { path: "C:/private/repository/secret.js", offset: 100 },
        }],
      },
    }, recorder.diagnostics);
    const completed = normalizeGrokDebugTraceEvent({
      type: "user",
      session_id: "session-1",
      message: {
        id: "turn-2-result",
        content: [{
          type: "tool_result",
          tool_use_id: "call-2",
          content: "TOP SECRET RESULT BODY",
        }],
      },
    }, recorder.diagnostics);

    for (const event of [...first, ...second, ...completed]) recorder.record(event);
    recorder.close();

    const events = readEvents(recorder.path).filter((event) => event.type !== "trace_metadata");
    assert.equal(events.length, 3);
    assert.match(events[0].argumentFingerprint, /^fp:[a-f0-9]{32}$/);
    assert.match(events[0].targetFingerprint, /^fp:[a-f0-9]{32}$/);
    assert.notEqual(events[0].argumentFingerprint, events[1].argumentFingerprint);
    assert.equal(events[0].targetFingerprint, events[1].targetFingerprint);
    assert.match(events[2].resultFingerprint, /^fp:[a-f0-9]{32}$/);
    assert.equal(events[2].resultBytes, Buffer.byteLength(JSON.stringify("TOP SECRET RESULT BODY")));
    assert.equal(events[2].resultTokenEstimate, Math.ceil(events[2].resultBytes / 4));
    assert.equal(events[0].turnSequence, 1);
    assert.equal(events[1].turnSequence, 2);

    const persisted = JSON.stringify(events);
    assert.doesNotMatch(persisted, /private\/repository|secret\.js|TOP SECRET RESULT BODY/i);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("trace analyzer exposes duplicate discovery, verification tail, polling, and context churn", () => {
  const base = Date.parse("2026-11-01T22:00:00.000Z");
  const at = (seconds) => new Date(base + seconds * 1000).toISOString();
  const events = [
    { type: "trace_metadata", provider: "grok", timestamp: at(0) },
    { type: "item_started", provider: "grok", timestamp: at(1), turnId: "id:t1", itemId: "id:1", itemType: "grep", argumentFingerprint: "fp:a", targetFingerprint: "fp:x" },
    { type: "item_completed", provider: "grok", timestamp: at(2), itemId: "id:1", outcome: "succeeded", resultFingerprint: "fp:r1", resultBytes: 4000, resultTokenEstimate: 1000 },
    { type: "item_started", provider: "grok", timestamp: at(5), turnId: "id:t2", itemId: "id:2", itemType: "grep", argumentFingerprint: "fp:a", targetFingerprint: "fp:x" },
    { type: "item_completed", provider: "grok", timestamp: at(6), itemId: "id:2", outcome: "succeeded", resultFingerprint: "fp:r1", resultBytes: 4000, resultTokenEstimate: 1000 },
    { type: "item_started", provider: "grok", timestamp: at(9), turnId: "id:t3", itemId: "id:3", itemType: "read_file", argumentFingerprint: "fp:b", targetFingerprint: "fp:y" },
    { type: "item_completed", provider: "grok", timestamp: at(10), itemId: "id:3", outcome: "succeeded", resultFingerprint: "fp:r2", resultBytes: 8000, resultTokenEstimate: 2000 },
    { type: "item_started", provider: "grok", timestamp: at(20), turnId: "id:t4", itemId: "id:4", itemType: "search_replace", argumentFingerprint: "fp:c", targetFingerprint: "fp:z" },
    { type: "item_completed", provider: "grok", timestamp: at(21), itemId: "id:4", outcome: "succeeded" },
    { type: "item_started", provider: "grok", timestamp: at(30), turnId: "id:t5", itemId: "id:5", itemType: "get_command_or_subagent_output" },
    { type: "item_completed", provider: "grok", timestamp: at(31), itemId: "id:5", outcome: "succeeded" },
    { type: "item_started", provider: "grok", timestamp: at(40), turnId: "id:t6", itemId: "id:6", itemType: "get_command_or_subagent_output" },
    { type: "item_completed", provider: "grok", timestamp: at(41), itemId: "id:6", outcome: "succeeded" },
    { type: "item_started", provider: "grok", timestamp: at(50), turnId: "id:t7", itemId: "id:7", itemType: "get_command_or_subagent_output" },
    { type: "item_completed", provider: "grok", timestamp: at(51), itemId: "id:7", outcome: "succeeded" },
    { type: "item_started", provider: "grok", timestamp: at(60), turnId: "id:t8", itemId: "id:8", itemType: "get_command_or_subagent_output" },
    { type: "item_completed", provider: "grok", timestamp: at(61), itemId: "id:8", outcome: "succeeded" },
    { type: "item_started", provider: "grok", timestamp: at(70), turnId: "id:t9", itemId: "id:9", itemType: "run_terminal_command" },
    { type: "item_completed", provider: "grok", timestamp: at(71), itemId: "id:9", outcome: "succeeded" },
    { type: "turn_completed", provider: "grok", timestamp: at(100), usageScope: "invocation", usage: { inputTokens: 470816, cachedInputTokens: 13994240, outputTokens: 93466 } },
  ];

  const analysis = analyzeTraceEvents(events);
  assert.equal(analysis.toolCalls, 9);
  assert.equal(analysis.failedToolCalls, 0);
  assert.equal(analysis.duplicateArgumentCalls, 1);
  assert.equal(analysis.duplicateResultCalls, 1);
  assert.equal(analysis.repeatedTargetCalls, 1);
  assert.equal(analysis.pollingCalls, 4);
  assert.equal(analysis.serialDiscoveryChains, 1);
  assert.equal(analysis.postFinalMutation.toolCalls, 5);
  assert.equal(analysis.postFinalMutation.mutations, 0);
  assert.equal(analysis.usage.inputTokens, 470816);
  assert.equal(analysis.usage.cachedInputTokens, 13994240);
  assert.equal(analysis.usage.outputTokens, 93466);
  assert(analysis.flags.some((flag) => flag.code === "context_churn" && flag.level === "HIGH"));
  assert(analysis.flags.some((flag) => flag.code === "serial_discovery"));
  assert(analysis.flags.some((flag) => flag.code === "subagent_polling"));

  const rendered = renderTraceAnalysis(analysis);
  assert.match(rendered, /Potential duplicate calls\s+1/);
  assert.match(rendered, /Post-final-edit work/);
  assert.match(rendered, /HIGH\s+context churn/);
});

test("github-delivery trace-analyze renders a local JSONL trace without invoking bootstrap", async () => {
  const root = mkdtempSync(join(tmpdir(), "gd-trace-analyze-cli-"));
  try {
    const path = join(root, "trace.jsonl");
    writeFileSync(path, [
      JSON.stringify({ type: "trace_metadata", provider: "grok", timestamp: "2026-11-01T22:00:00.000Z" }),
      JSON.stringify({ type: "item_started", provider: "grok", timestamp: "2026-11-01T22:00:01.000Z", turnId: "id:t1", itemId: "id:i1", itemType: "read_file" }),
      JSON.stringify({ type: "item_completed", provider: "grok", timestamp: "2026-11-01T22:00:02.000Z", itemId: "id:i1", outcome: "succeeded" }),
    ].join("\n") + "\n");

    const output = captureStream();
    let bootstrapCalled = false;
    const result = await main(["trace-analyze", path], {
      stdout: output.stream,
      runBootstrap: async () => {
        bootstrapCalled = true;
        throw new Error("bootstrap must not run for trace-analyze");
      },
    });

    assert.equal(bootstrapCalled, false);
    assert.equal(result.action, "trace-analyze");
    assert.equal(result.analysis.toolCalls, 1);
    assert.match(output.text(), /Trace efficiency analysis/);
    assert.match(output.text(), /Tool calls\s+1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
