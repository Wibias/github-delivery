import assert from "node:assert/strict";
import test from "node:test";

import { createProgressWatchdog } from "../../scripts/lib/agent-progress-watchdog.mjs";
import { observeCodexAppServerMessage } from "../../scripts/lib/codex-progress-watchdog.mjs";
import {
  classifyAppServerItem,
  classifyHookTool,
} from "../../scripts/lib/watchdog-progress-classifier.mjs";

const OPERATIONAL_POLLS = [
  "Get-Process -Id 32188",
  "Get-CimInstance Win32_Process -Filter 'ParentProcessId=32188'",
  "tasklist /FI \"PID eq 32188\"",
  "ps -p 32188 -o pid=,stat=,command=",
  "pgrep -P 32188",
  "git worktree list",
];

test("operational process and worktree polling is volatile evidence", () => {
  for (const command of OPERATIONAL_POLLS) {
    assert.deepEqual(
      classifyHookTool({ tool_name: "Bash", tool_input: { command } }),
      { kind: "evidence", volatility: "volatile" },
      command,
    );
    assert.deepEqual(
      classifyAppServerItem({ type: "commandExecution", command }),
      { kind: "evidence", volatility: "volatile" },
      command,
    );
  }
});

test("protected stream charges repeated process polling against the evidence budget", () => {
  const watchdog = createProgressWatchdog({
    evidenceSoftLimit: 1,
    evidenceHardLimit: 2,
  });
  const context = { interruptedTurns: new Set() };

  const first = observeCodexAppServerMessage(
    watchdog,
    {
      method: "item/started",
      params: {
        threadId: "thr_poll",
        turnId: "turn_poll",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "Get-Process -Id 32188",
        },
      },
    },
    context,
  );
  assert.equal(first.interrupt, undefined);

  const second = observeCodexAppServerMessage(
    watchdog,
    {
      method: "item/started",
      params: {
        threadId: "thr_poll",
        turnId: "turn_poll",
        item: {
          type: "commandExecution",
          id: "cmd_2",
          command: "Get-CimInstance Win32_Process -Filter 'ParentProcessId=32188'",
        },
      },
    },
    context,
  );

  assert.equal(second.decision.reason, "evidence_budget_exhausted");
  assert.deepEqual(second.interrupt, {
    method: "turn/interrupt",
    params: { threadId: "thr_poll", turnId: "turn_poll" },
  });
});
