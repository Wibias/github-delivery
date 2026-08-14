import assert from "node:assert/strict";
import test from "node:test";

import {
  compactToolOutput,
  createProgressWatchdog,
} from "../../scripts/lib/agent-progress-watchdog.mjs";
import {
  observeCodexAppServerMessage,
} from "../../scripts/lib/codex-progress-watchdog.mjs";

test("stream watchdog interrupts repeated intent narration before it can grow unbounded", () => {
  const watchdog = createProgressWatchdog();
  const phrases = [
    "Let me read the mutation-modes reference.\n",
    "Let me read the reference.\n",
    "Let me check the mutation modes reference.\n",
    "Let me read the reference.\n",
    "Let me read mutation-modes.md.\n",
    "Let me read the reference.\n",
  ];

  let decision = { action: "allow" };
  let emitted = 0;
  for (const phrase of phrases) {
    emitted += phrase.length;
    decision = watchdog.observeAssistantDelta(phrase);
    if (decision.action === "interrupt") break;
  }

  assert.equal(decision.action, "interrupt");
  assert.equal(decision.reason, "no_progress_stall");
  assert.ok(emitted < 500, `watchdog allowed ${emitted} characters before interrupting`);
});

test("stream watchdog interrupts repeated grid protocol placeholders in one message", () => {
  const watchdog = createProgressWatchdog();
  const decision = watchdog.observeAssistantDelta([
    "Let me apply the patch.",
    "grid",
    "Let me execute it.",
    "<grid></grid>",
    "grid",
  ].join("\n"));

  assert.equal(decision.action, "interrupt");
  assert.equal(decision.reason, "tool_protocol_emission_stall");
  assert.equal(decision.details.protocolArtifactCount, 3);
});

test("stream watchdog counts repeated paired tool-protocol blocks without double-counting tags", () => {
  const watchdog = createProgressWatchdog();
  const decision = watchdog.observeAssistantDelta([
    "<atool></atool>",
    "<invoke></invoke>",
    "<atool></atool>",
  ].join("\n"));

  assert.equal(decision.action, "interrupt");
  assert.equal(decision.reason, "tool_protocol_emission_stall");
  assert.equal(decision.details.protocolArtifactCount, 3);
});

test("split opening and closing protocol tags count as one block across stream chunks", () => {
  const watchdog = createProgressWatchdog();

  assert.equal(watchdog.observeAssistantDelta("<invoke>").action, "allow");
  assert.equal(watchdog.observeAssistantDelta("</invoke>").action, "allow");
  const secondBlock = watchdog.observeAssistantDelta("<atool></atool>");

  assert.equal(secondBlock.action, "interrupt");
  assert.equal(secondBlock.reason, "tool_protocol_emission_stall");
  assert.equal(secondBlock.details.protocolArtifactCount, 2);
});

test("normal concise planning prose does not trigger a narration stall", () => {
  const watchdog = createProgressWatchdog();
  const text = [
    "I found the failing gate and its concrete blocker.\n",
    "Let me inspect the one file that owns that rule.\n",
    "After that I can patch the regression and run the aggregate check.\n",
  ];

  for (const delta of text) {
    assert.equal(watchdog.observeAssistantDelta(delta).action, "allow");
  }
});

test("external progress resets the assistant narration window", () => {
  const watchdog = createProgressWatchdog();
  watchdog.observeAssistantDelta("Let me read the reference.\n");
  watchdog.observeAssistantDelta("Let me read the reference.\n");
  watchdog.recordExternalProgress({ kind: "tool_call", toolName: "fetch_file" });

  assert.equal(
    watchdog.observeAssistantDelta("Let me read the reference.\n").action,
    "allow",
  );
});

test("stable duplicate reads are blocked until relevant state changes", () => {
  const watchdog = createProgressWatchdog();
  const read = {
    toolName: "fetch_file",
    input: { repository: "o/r", path: "README.md", ref: "abc" },
    volatility: "stable",
    now: 1_000,
  };

  assert.equal(watchdog.decideRead(read).action, "allow");
  assert.equal(watchdog.decideRead({ ...read, now: 2_000 }).action, "block");

  watchdog.recordStateChange("write_completed");
  assert.equal(watchdog.decideRead({ ...read, now: 3_000 }).action, "allow");
});

test("volatile duplicate reads are rate limited rather than cached forever", () => {
  const watchdog = createProgressWatchdog({ volatileReadIntervalMs: 30_000 });
  const read = {
    toolName: "gh_pr_checks",
    input: { repo: "o/r", pr: 42 },
    volatility: "volatile",
  };

  assert.equal(watchdog.decideRead({ ...read, now: 1_000 }).action, "allow");
  assert.equal(watchdog.decideRead({ ...read, now: 10_000 }).action, "block");
  assert.equal(watchdog.decideRead({ ...read, now: 31_001 }).action, "allow");
});

test("oversized tool output is compacted with failure evidence and omission metadata", () => {
  const input = [
    "header",
    ...Array.from({ length: 100 }, (_, index) => `ordinary line ${index}`),
    "ERROR unsponsored_surface",
    "exit code: 1",
    ...Array.from({ length: 100 }, (_, index) => `tail line ${index}`),
  ].join("\n");

  const compacted = compactToolOutput(input, { maxChars: 900 });
  assert.equal(compacted.truncated, true);
  assert.ok(compacted.text.length <= 900);
  assert.match(compacted.text, /ERROR unsponsored_surface/);
  assert.match(compacted.text, /exit code: 1/);
  assert.ok(compacted.omittedChars > 0);
  assert.equal(compacted.originalChars, input.length);
});

test("Codex App Server streaming adapter emits one interrupt for a stalled turn", () => {
  const watchdog = createProgressWatchdog();
  const context = { interruptedTurns: new Set() };
  let outcome = null;

  for (const delta of [
    "Let me read the reference.\n",
    "Let me read the reference.\n",
    "Let me read the reference.\n",
  ]) {
    outcome = observeCodexAppServerMessage(
      watchdog,
      {
        method: "item/agentMessage/delta",
        params: {
          threadId: "thr_1",
          turnId: "turn_1",
          itemId: "item_1",
          delta,
        },
      },
      context,
    );
  }

  assert.equal(outcome?.interrupt?.method, "turn/interrupt");
  assert.deepEqual(outcome.interrupt.params, {
    threadId: "thr_1",
    turnId: "turn_1",
  });

  const duplicate = observeCodexAppServerMessage(
    watchdog,
    {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        itemId: "item_1",
        delta: "Let me read the reference.\n",
      },
    },
    context,
  );
  assert.equal(duplicate?.interrupt, undefined);
});

test("ordinary Codex App Server notifications do not create interrupts", () => {
  const watchdog = createProgressWatchdog();
  const context = { interruptedTurns: new Set() };
  const outcome = observeCodexAppServerMessage(
    watchdog,
    {
      method: "item/started",
      params: {
        threadId: "thr_1",
        turnId: "turn_1",
        item: { type: "commandExecution", id: "cmd_1" },
      },
    },
    context,
  );

  assert.equal(outcome?.interrupt, undefined);
});
