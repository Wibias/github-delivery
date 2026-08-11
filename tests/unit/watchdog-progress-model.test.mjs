import assert from "node:assert/strict";
import test from "node:test";

import { createProgressWatchdog } from "../../scripts/lib/agent-progress-watchdog.mjs";
import {
  classifyAppServerItem,
  classifyHookTool,
} from "../../scripts/lib/watchdog-progress-classifier.mjs";
import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

test("evidence attempts warn once before the hard per-turn limit", () => {
  const watchdog = createProgressWatchdog({ evidenceSoftLimit: 2, evidenceHardLimit: 4 });

  assert.equal(watchdog.chargeEvidenceAttempt().action, "allow");
  assert.equal(watchdog.chargeEvidenceAttempt().action, "warn");
  assert.equal(watchdog.chargeEvidenceAttempt().action, "allow");
  const blocked = watchdog.chargeEvidenceAttempt();
  assert.equal(blocked.action, "block");
  assert.equal(blocked.reason, "evidence_budget_exhausted");
  assert.equal(blocked.consecutiveEvidenceAttempts, 4);
});

test("evidence does not reset narration while execution and state progress do", () => {
  const watchdog = createProgressWatchdog();
  watchdog.observeAssistantDelta("Let me read request-log.test.ts.\n");
  watchdog.chargeEvidenceAttempt();
  watchdog.observeAssistantDelta("Let me read request-log.test.ts.\n");
  watchdog.chargeEvidenceAttempt();
  assert.equal(
    watchdog.observeAssistantDelta("Let me read request-log.test.ts.\n").action,
    "interrupt",
  );

  const afterExecution = createProgressWatchdog();
  afterExecution.observeAssistantDelta("Let me read request-log.test.ts.\n");
  afterExecution.observeAssistantDelta("Let me read request-log.test.ts.\n");
  afterExecution.recordExecutionProgress();
  assert.equal(
    afterExecution.observeAssistantDelta("Let me read request-log.test.ts.\n").action,
    "allow",
  );

  const afterState = createProgressWatchdog();
  afterState.observeAssistantDelta("Let me read request-log.test.ts.\n");
  afterState.observeAssistantDelta("Let me read request-log.test.ts.\n");
  afterState.recordStateProgress();
  assert.equal(
    afterState.observeAssistantDelta("Let me read request-log.test.ts.\n").action,
    "allow",
  );
});

test("execution resets evidence streak but does not invalidate stable-read fingerprints", () => {
  const watchdog = createProgressWatchdog({ evidenceSoftLimit: 2, evidenceHardLimit: 4 });
  const read = {
    toolName: "mcp__github__fetch_file",
    input: { repo: "o/r", path: "README.md", ref: "abc" },
    volatility: "stable",
    now: 1_000,
  };
  assert.equal(watchdog.decideRead(read).action, "allow");
  watchdog.chargeEvidenceAttempt();
  watchdog.recordExecutionProgress();
  assert.equal(watchdog.snapshot().consecutiveEvidenceAttempts, 0);
  assert.equal(watchdog.decideRead({ ...read, now: 2_000 }).action, "block");
});

test("state progress resets evidence and invalidates stable-read fingerprints", () => {
  const watchdog = createProgressWatchdog({ evidenceSoftLimit: 2, evidenceHardLimit: 4 });
  const read = {
    toolName: "mcp__github__fetch_file",
    input: { repo: "o/r", path: "README.md", ref: "abc" },
    volatility: "stable",
    now: 1_000,
  };
  assert.equal(watchdog.decideRead(read).action, "allow");
  watchdog.chargeEvidenceAttempt();
  watchdog.recordStateProgress();
  assert.equal(watchdog.snapshot().consecutiveEvidenceAttempts, 0);
  assert.equal(watchdog.decideRead({ ...read, now: 2_000 }).action, "allow");
});

test("PreToolUse soft evidence warning uses supported model-visible context without blocking", () => {
  let state = {};
  const first = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s",
      turn_id: "t",
      tool_name: "mcp__github__fetch_file",
      tool_input: { path: "a" },
    },
    state,
    { evidenceSoftLimit: 2, evidenceHardLimit: 4, now: 1_000 },
  );
  state = first.state;
  const second = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s",
      turn_id: "t",
      tool_name: "mcp__github__fetch_file",
      tool_input: { path: "b" },
    },
    state,
    { evidenceSoftLimit: 2, evidenceHardLimit: 4, now: 2_000 },
  );

  assert.equal(second.output?.decision, undefined);
  assert.equal(second.output?.hookSpecificOutput?.hookEventName, "PreToolUse");
  assert.match(second.output?.hookSpecificOutput?.additionalContext || "", /synthesi[sz]e|evidence/i);
});

test("shared classifier is conservative about progress", () => {
  assert.deepEqual(
    classifyHookTool({ tool_name: "mcp__github__fetch_file", tool_input: {} }),
    { kind: "evidence", volatility: "stable" },
  );
  assert.equal(
    classifyHookTool({ tool_name: "mcp__github__create_pull_request", tool_input: {} }).kind,
    "state-change",
  );
  assert.equal(
    classifyHookTool({ tool_name: "Bash", tool_input: { command: "npm run check" } }).kind,
    "execution",
  );
  assert.equal(
    classifyHookTool({ tool_name: "Bash", tool_input: { command: "Get-Content README.md" } }).kind,
    "evidence",
  );
  assert.equal(classifyHookTool({ tool_name: "mystery_tool", tool_input: {} }).kind, "neutral");

  assert.equal(classifyAppServerItem({ type: "webSearch" }).kind, "evidence");
  assert.equal(classifyAppServerItem({ type: "imageView" }).kind, "evidence");
  assert.equal(classifyAppServerItem({ type: "fileChange" }).kind, "state-change");
  assert.equal(classifyAppServerItem({ type: "reasoning" }).kind, "neutral");
});
