import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";
import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";
import { replayCodexWatchdogTrace } from "../../scripts/lib/codex-watchdog-replay.mjs";

function replay(messages, watchdogOptions = undefined) {
  return replayCodexWatchdogTrace(messages, {
    router: createAppServerWatchdogRouter({
      internalRequestIdPrefix: "gd-regression",
      watchdogOptions,
    }),
  });
}

function delta(method, text, itemId = "reasoning") {
  return {
    method,
    params: {
      threadId: "thr-regression",
      turnId: "turn-regression",
      itemId,
      delta: text,
    },
  };
}

function usage(outputTokens, totalTokens = outputTokens + 10_000) {
  return {
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thr-regression",
      turnId: "turn-regression",
      tokenUsage: {
        total: { inputTokens: totalTokens - outputTokens, outputTokens, totalTokens },
        last: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    },
  };
}

test("incident: Baseline-is-green tool-emission stall interrupts within six generated clauses", () => {
  const lines = [
    "Baseline is green. Let me wire attribution into core.ts.\n",
    "Baseline is green. Let me add the import.\n",
    "Let me read the main attempt creation region.\n",
    "Green baseline. Let me run the exact inspection.\n",
    "Now execute the read of the target region.\n",
    "I'll invoke the command now.\n",
    "Running the tool next.\n",
  ];
  const result = replay(lines.map((text) => delta("item/reasoning/summaryTextDelta", text)));
  assert.equal(result.interruptCount, 1);
  assert.ok(result.firstInterruptEvent <= 6, `interrupted at event ${result.firstInterruptEvent}`);
});

test("incident: malformed tool-protocol emission interrupts on the second malformed emission", () => {
  const result = replay([
    delta("item/reasoning/summaryTextDelta", "Let me grep. <atool></atool>\n"),
    delta("item/reasoning/summaryTextDelta", "Run grep. <atool></atool>\n"),
    delta("item/reasoning/summaryTextDelta", "exec. <invoke></invoke>\n"),
  ]);
  assert.equal(result.interruptCount, 1);
  assert.equal(result.firstInterruptEvent, 2);
});

test("incident: channel hopping cannot evade repeated tool intent", () => {
  const methods = [
    "item/reasoning/summaryTextDelta",
    "item/agentMessage/delta",
    "item/plan/delta",
    "item/reasoning/textDelta",
  ];
  const result = replay(
    Array.from({ length: 8 }, (_, index) =>
      delta(methods[index % methods.length], "Let me run the grep now.\n", `item-${index}`),
    ),
  );
  assert.equal(result.interruptCount, 1);
  assert.ok(result.firstInterruptEvent <= 6);
});

test("incident: differently filtered reads of one Actions run are blocked after first evidence", () => {
  const common = {
    session_id: "session-ci-loop",
    turn_id: "turn-ci-loop",
    tool_name: "Bash",
  };
  const first = evaluateCodexHook(
    {
      ...common,
      hook_event_name: "PreToolUse",
      tool_input: {
        command: "gh -R lidge-jun/opencodex run view 31542325111 --log-failed | Select-String timeout",
      },
    },
    {},
    { now: 1_000 },
  );
  assert.equal(first.output, null);
  const captured = evaluateCodexHook(
    {
      ...common,
      hook_event_name: "PostToolUse",
      tool_input: {
        command: "gh -R lidge-jun/opencodex run view 31542325111 --log-failed | Select-String timeout",
      },
      tool_response: "captured failure evidence",
    },
    first.state,
    { now: 1_100 },
  );
  const repeated = evaluateCodexHook(
    {
      ...common,
      hook_event_name: "PreToolUse",
      tool_input: {
        command: "gh -R lidge-jun/opencodex run view 31542325111 --log-failed | Select-String SIGSEGV",
      },
    },
    captured.state,
    { now: 1_200 },
  );
  assert.equal(repeated.output?.decision, "block");
});

test("active workflow unique no-progress generation is hard bounded by production defaults", () => {
  const messages = [];
  for (let index = 0; index < 20; index += 1) {
    messages.push(
      delta(
        "item/reasoning/summaryTextDelta",
        `Distinct analysis paragraph ${index}: ${"x".repeat(2_000)}\n`,
        `reason-${index}`,
      ),
    );
  }
  const result = replay(messages);
  assert.equal(result.interruptCount, 1);
  assert.ok(result.firstInterruptEvent <= 16, `unbounded until event ${result.firstInterruptEvent}`);
});

test("active workflow cumulative output tokens are bounded while large input growth is ignored", () => {
  const result = replay([
    usage(100, 50_000),
    usage(4_000, 90_000),
    usage(8_101, 150_000),
  ]);
  assert.equal(result.interruptCount, 1);
  assert.equal(result.firstInterruptEvent, 3);
});

test("false-positive corpus: completed-plan final verdict may exceed ordinary in-workflow character budget", () => {
  const result = replay([
    {
      method: "turn/plan/updated",
      params: {
        threadId: "thr-regression",
        turnId: "turn-regression",
        plan: [
          { step: "inspect", status: "completed" },
          { step: "verify", status: "completed" },
          { step: "publish final verdict", status: "completed" },
        ],
      },
    },
    usage(100),
    delta("item/agentMessage/delta", `Final review verdict:\n${"v".repeat(20_000)}`, "final-answer"),
    usage(9_000),
  ]);
  assert.equal(result.interruptCount, 0);
});

test("finalization allowance does not disable malformed tool-emission detection", () => {
  const result = replay([
    {
      method: "turn/plan/updated",
      params: {
        threadId: "thr-regression",
        turnId: "turn-regression",
        plan: [{ step: "all work", status: "completed" }],
      },
    },
    delta("item/agentMessage/delta", "Let me run it. <atool></atool>\n", "final-1"),
    delta("item/agentMessage/delta", "Executing. <atool></atool>\n", "final-2"),
  ]);
  assert.equal(result.interruptCount, 1);
  assert.equal(result.firstInterruptEvent, 3);
});

test("false-positive corpus: legitimate tool-rich investigation with real progress is not interrupted", () => {
  const messages = [];
  messages.push(usage(100));
  for (let index = 0; index < 5; index += 1) {
    messages.push(delta("item/reasoning/summaryTextDelta", `Inspecting distinct required area ${index}.\n`, `r-${index}`));
    messages.push({
      method: "item/started",
      params: {
        threadId: "thr-regression",
        turnId: "turn-regression",
        item: {
          id: `cmd-${index}`,
          type: "commandExecution",
          command: `npm test -- area-${index}`,
          status: "inProgress",
        },
      },
    });
    messages.push({
      method: "item/completed",
      params: {
        threadId: "thr-regression",
        turnId: "turn-regression",
        item: {
          id: `cmd-${index}`,
          type: "commandExecution",
          command: `npm test -- area-${index}`,
          status: "completed",
          exitCode: 0,
        },
      },
    });
    messages.push({
      method: "turn/diff/updated",
      params: {
        threadId: "thr-regression",
        turnId: "turn-regression",
        diff: `diff --git a/f${index}.ts b/f${index}.ts\n+change-${index}\n`,
      },
    });
    messages.push(usage(500 + index * 1_000));
  }
  const result = replay(messages);
  assert.equal(result.interruptCount, 0);
});
