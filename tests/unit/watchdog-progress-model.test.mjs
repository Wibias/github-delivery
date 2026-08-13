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

test("a read denied only by the hard evidence budget is not cached as completed evidence", () => {
  const options = { evidenceSoftLimit: 1, evidenceHardLimit: 2 };
  let state = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s",
      turn_id: "t",
      tool_name: "mcp__github__fetch_file",
      tool_input: { path: "a" },
    },
    {},
    { ...options, now: 1_000 },
  ).state;

  const denied = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s",
      turn_id: "t",
      tool_name: "mcp__github__fetch_file",
      tool_input: { path: "b" },
    },
    state,
    { ...options, now: 2_000 },
  );
  assert.equal(denied.output?.decision, "block");
  state = denied.state;

  state = evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      session_id: "s",
      turn_id: "t",
      tool_name: "Bash",
      tool_input: { command: "npm run check" },
      tool_response: "ok",
    },
    state,
    { ...options, now: 3_000 },
  ).state;

  const retry = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "s",
      turn_id: "t",
      tool_name: "mcp__github__fetch_file",
      tool_input: { path: "b" },
    },
    state,
    { ...options, now: 4_000 },
  );
  assert.notEqual(retry.output?.decision, "block");
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

test("incident: OpenCodex GUI read exploration warns at 8 and blocks the 12th evidence read", () => {
  const commands = [
    "$c=Get-Content -LiteralPath 'C:\\repo\\gui\\src\\pages\\dashboard-overview-sections.tsx'; $c[430..565]",
    "$c=Get-Content -LiteralPath 'C:\\repo\\gui\\src\\pages\\dashboard-overview-sections.tsx'; $c[545..630]",
    "Select-String -Path 'C:\\repo\\gui\\src\\pages\\dashboard-shared.ts' -Pattern 'visionEnabledPatch|SidecarPatch'",
    "$c=Get-Content -LiteralPath 'C:\\repo\\gui\\src\\pages\\dashboard-shared.ts'; $c[65..95]",
    "$c=Get-Content -LiteralPath 'C:\\repo\\gui\\src\\pages\\dashboard-shared.ts'; $c[190..260]",
    "Get-ChildItem -LiteralPath 'C:\\repo\\gui\\src\\i18n' -Filter '*.ts' | Select-Object -ExpandProperty Name",
    "Select-String -Path 'C:\\repo\\gui\\src\\i18n\\catalogs.ts' -Pattern 'dash.sidecarModel'",
    "Select-String -Path 'C:\\repo\\gui\\src\\i18n\\en.ts' -Pattern 'dash.visionSidecar'",
    "Get-ChildItem -Recurse -LiteralPath 'C:\\repo\\gui\\src' -Filter '*.ts*' | Where-Object { $_.Name -match 'ui' }",
    "$c=Get-Content -LiteralPath 'C:\\repo\\gui\\src\\ui.tsx'; $c[1..40]",
    "Select-String -Path 'C:\\repo\\gui\\tests\\vision-sidecar-dashboard.test.tsx' -Pattern '^test\\('",
    "$c=Get-Content -LiteralPath 'C:\\repo\\gui\\tests\\vision-sidecar-dashboard.test.tsx'; $c[204..248]",
  ];

  let state = {};
  const options = {
    evidenceSoftLimit: 8,
    evidenceHardLimit: 12,
  };

  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];

    const pre = evaluateCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "opencodex-gui-session",
        turn_id: "opencodex-gui-turn",
        tool_name: "Bash",
        tool_input: { command },
      },
      state,
      {
        ...options,
        now: 1_000 + index * 100,
      },
    );

    if (index < 7) {
      assert.equal(pre.output, null, `unexpected intervention at read ${index + 1}`);
    } else if (index === 7) {
      assert.equal(pre.output?.decision, undefined);
      assert.equal(pre.output?.hookSpecificOutput?.hookEventName, "PreToolUse");
      assert.match(
        pre.output?.hookSpecificOutput?.additionalContext || "",
        /evidence|synthesi[sz]e/i,
      );
    } else if (index < 11) {
      assert.equal(pre.output, null, `unexpected intervention at read ${index + 1}`);
    } else {
      assert.equal(pre.output?.decision, "block");
      assert.match(pre.output?.reason || "", /budget exhausted/i);
      break;
    }

    state = pre.state;

    const post = evaluateCodexHook(
      {
        hook_event_name: "PostToolUse",
        session_id: "opencodex-gui-session",
        turn_id: "opencodex-gui-turn",
        tool_name: "Bash",
        tool_input: { command },
        tool_response: "ok",
      },
      state,
      {
        ...options,
        now: 1_050 + index * 100,
      },
    );

    state = post.state;
  }
});

test("incident: Bun validation resets the OpenCodex evidence streak", () => {
  let state = {};
  const options = {
    evidenceSoftLimit: 8,
    evidenceHardLimit: 12,
  };

  for (let index = 0; index < 7; index += 1) {
    const command =
      `$c=Get-Content -LiteralPath 'C:\\repo\\before-${index}.ts'; $c[1..20]`;

    const pre = evaluateCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "opencodex-bun-session",
        turn_id: "opencodex-bun-turn",
        tool_name: "Bash",
        tool_input: { command },
      },
      state,
      { ...options, now: 1_000 + index * 100 },
    );

    assert.equal(pre.output, null);
    state = pre.state;
  }

  const execution = evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      session_id: "opencodex-bun-session",
      turn_id: "opencodex-bun-turn",
      tool_name: "Bash",
      tool_input: { command: "bun run typecheck" },
      tool_response: "ok",
    },
    state,
    { ...options, now: 2_000 },
  );

  state = execution.state;

  assert.equal(state.watchdog.consecutiveEvidenceAttempts, 0);

  for (let index = 0; index < 7; index += 1) {
    const command =
      `$c=Get-Content -LiteralPath 'C:\\repo\\after-${index}.ts'; $c[1..20]`;

    const pre = evaluateCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "opencodex-bun-session",
        turn_id: "opencodex-bun-turn",
        tool_name: "Bash",
        tool_input: { command },
      },
      state,
      { ...options, now: 3_000 + index * 100 },
    );

    assert.equal(pre.output, null, `unexpected intervention after Bun at read ${index + 1}`);
    state = pre.state;
  }
});
