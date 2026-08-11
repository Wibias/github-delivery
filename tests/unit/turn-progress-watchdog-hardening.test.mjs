import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCodexWatchdogHook } from "../../scripts/codex-watchdog-hook.mjs";
import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";

function narration(router, turnId, text, threadId = "thr-1") {
  return router.onServerMessage({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: `msg-${turnId}`, delta: text },
  });
}

function evidenceItem(router, turnId, id, type = "webSearch", threadId = "thr-1") {
  router.onServerMessage({
    method: "item/started",
    params: { threadId, turnId, item: { id, type, query: `query-${id}` } },
  });
  return router.onServerMessage({
    method: "item/completed",
    params: { threadId, turnId, item: { id, type, query: `query-${id}` } },
  });
}

test("stream evidence does not reset repeated narration detection", () => {
  const router = createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-hardening" });

  narration(router, "turn-a", "Let me inspect the next reference.\n");
  evidenceItem(router, "turn-a", "search-1");
  narration(router, "turn-a", "Let me inspect the next reference.\n");
  evidenceItem(router, "turn-a", "search-2");
  const tripped = narration(router, "turn-a", "Let me inspect the next reference.\n");

  assert.equal(tripped.internalRequests.length, 1);
  assert.equal(tripped.internalRequests[0].method, "turn/interrupt");
  assert.deepEqual(tripped.internalRequests[0].params, {
    threadId: "thr-1",
    turnId: "turn-a",
  });
});

test("hook mode bounds distinct evidence reads within one turn", () => {
  let state = {};
  const options = {
    now: 1_000,
    evidenceSoftLimit: 2,
    evidenceHardLimit: 4,
  };

  for (let index = 0; index < 3; index += 1) {
    const result = runHookRead(index, state, options);
    assert.notEqual(result.output?.decision, "block", `read ${index + 1} should still be allowed`);
    state = result.state;
  }

  const blocked = runHookRead(3, state, options);
  assert.equal(blocked.output?.decision, "block");
  assert.match(blocked.output?.reason || "", /evidence|synthesi[sz]e|exploration/i);
});

function runHookRead(index, state, options) {
  const { evaluateCodexHook } = hookModule;
  return evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "session-budget",
      turn_id: "turn-budget",
      tool_name: "mcp__github__fetch_file",
      tool_input: { repo: "o/r", path: `src/file-${index}.mjs`, ref: "abc" },
    },
    state,
    options,
  );
}

import * as hookModule from "../../scripts/lib/codex-watchdog-hook.mjs";

test("hook persistence isolates turn IDs within one session", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-turn-isolation-"));
  const common = {
    hook_event_name: "PreToolUse",
    session_id: "shared-session",
    tool_name: "mcp__github__fetch_file",
    tool_input: { repo: "o/r", path: "README.md", ref: "abc" },
  };

  const first = runCodexWatchdogHook(
    { ...common, turn_id: "turn-one" },
    { stateRoot: root, now: 1_000 },
  );
  assert.equal(first.output, null);

  const secondTurn = runCodexWatchdogHook(
    { ...common, turn_id: "turn-two" },
    { stateRoot: root, now: 2_000 },
  );
  assert.equal(secondTurn.output, null);
});

test("progress in one App Server turn cannot reset another turn", () => {
  const router = createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-isolation" });

  narration(router, "turn-a", "Let me read request-log.test.ts.\n", "thr-a");
  narration(router, "turn-a", "Let me read request-log.test.ts.\n", "thr-a");

  router.onServerMessage({
    method: "item/completed",
    params: {
      threadId: "thr-b",
      turnId: "turn-b",
      item: { id: "write-b", type: "fileChange", changes: [] },
    },
  });

  const tripped = narration(router, "turn-a", "Let me read request-log.test.ts.\n", "thr-a");
  assert.equal(tripped.internalRequests.length, 1);
  assert.deepEqual(tripped.internalRequests[0].params, {
    threadId: "thr-a",
    turnId: "turn-a",
  });
});

test("pure request-log narration incident is interrupted before 500 characters", () => {
  const router = createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-request-log" });
  let emitted = 0;
  let tripped = null;

  for (let index = 0; index < 20; index += 1) {
    const delta = "Let me read request-log.test.ts.\n";
    emitted += delta.length;
    const result = narration(router, "turn-request-log", delta, "thr-request-log");
    if (result.internalRequests.length) {
      tripped = result;
      break;
    }
  }

  assert.ok(tripped, "expected the repeated narration turn to be interrupted");
  assert.ok(emitted < 500, `watchdog allowed ${emitted} characters before interruption`);
  assert.equal(tripped.internalRequests.length, 1);
});
