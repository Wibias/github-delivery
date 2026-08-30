import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";
import { observeCodexAppServerMessage } from "../../scripts/lib/codex-progress-watchdog.mjs";
import { createProgressWatchdog } from "../../scripts/lib/watchdog-investigation-progress.mjs";

function preEvidence(state, command, now, options = {}) {
  return evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    },
    state,
    {
      now,
      evidenceSoftLimit: 2,
      evidenceHardLimit: 3,
      ...options,
    },
  );
}

function runEvidence(state, command, response, now, options = {}) {
  const pre = preEvidence(state, command, now, options);
  assert.equal(pre.output?.decision, undefined, pre.output?.reason);
  return evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: response,
    },
    pre.state,
    {
      now: now + 1,
      evidenceSoftLimit: 2,
      evidenceHardLimit: 3,
      ...options,
    },
  ).state;
}

function runAppServerEvidence(watchdog, context, command, response, index) {
  const common = {
    threadId: "thr-investigation",
    turnId: "turn-investigation",
  };
  const started = observeCodexAppServerMessage(
    watchdog,
    {
      method: "item/started",
      params: {
        ...common,
        item: {
          id: `cmd-${index}`,
          type: "commandExecution",
          command,
          status: "inProgress",
        },
      },
    },
    context,
  );
  assert.equal(started.interrupt, undefined, started.decision?.reason);
  observeCodexAppServerMessage(
    watchdog,
    {
      method: "item/completed",
      params: {
        ...common,
        item: {
          id: `cmd-${index}`,
          type: "commandExecution",
          command,
          status: "completed",
          exitCode: 0,
          aggregatedOutput: response,
        },
      },
    },
    context,
  );
}

test("dependency-following source reads can reach one complete RED regression before execution", () => {
  let state = {};
  state = runEvidence(
    state,
    "Get-Content src/authority-entrypoint.mjs",
    'import { resolveStoredCredential } from "./stored-credential-resolver.mjs";',
    1_000,
  );
  state = runEvidence(
    state,
    "Get-Content src/stored-credential-resolver.mjs",
    'import { refreshManagedToken } from "./managed-token-refresh.mjs";',
    2_000,
  );
  state = runEvidence(
    state,
    "Get-Content src/managed-token-refresh.mjs",
    'See the existing retry contract in "../tests/stored-account-retry.test.mjs".',
    3_000,
  );
  state = runEvidence(
    state,
    "Get-Content tests/stored-account-retry.test.mjs",
    "test(\"stored account refreshes once after 401\", () => {});",
    4_000,
  );

  assert.equal(state.watchdog.totalEvidenceAttempts, 4);
  assert.equal(state.watchdog.investigationCreditsUsed, 3);
});

test("unrelated source reads still exhaust the ordinary consecutive evidence budget", () => {
  let state = {};
  state = runEvidence(state, "Get-Content src/a.mjs", "export const a = 1;", 1_000);
  state = runEvidence(state, "Get-Content src/b.mjs", "export const b = 1;", 2_000);

  const blocked = preEvidence(state, "Get-Content src/c.mjs", 3_000);
  assert.equal(blocked.output?.decision, "block");
  assert.match(blocked.output?.reason || "", /Evidence exploration budget exhausted/);
});

test("assistant prose cannot manufacture dependency-following investigation credit", () => {
  let state = runEvidence(
    {},
    "Get-Content src/a.mjs",
    "export const a = 1;",
    1_000,
    { evidenceSoftLimit: 1, evidenceHardLimit: 2 },
  );
  state = evaluateCodexHook(
    {
      hook_event_name: "Stop",
      last_assistant_message: 'The next dependency is "src/b.mjs".',
    },
    state,
    { now: 1_500, evidenceSoftLimit: 1, evidenceHardLimit: 2 },
  ).state;

  const blocked = preEvidence(
    state,
    "Get-Content src/b.mjs",
    2_000,
    { evidenceSoftLimit: 1, evidenceHardLimit: 2 },
  );
  assert.equal(blocked.output?.decision, "block");
});

test("dependency-following investigation credit is capped per state generation", () => {
  const options = { investigationCreditLimit: 2 };
  let state = {};
  state = runEvidence(
    state,
    "Get-Content src/a.mjs",
    'export { b } from "./b.mjs";',
    1_000,
    options,
  );
  state = runEvidence(
    state,
    "Get-Content src/b.mjs",
    'export { c } from "./c.mjs";',
    2_000,
    options,
  );
  state = runEvidence(
    state,
    "Get-Content src/c.mjs",
    'export { d } from "./d.mjs";',
    3_000,
    options,
  );
  state = runEvidence(
    state,
    "Get-Content src/d.mjs",
    'export { e } from "./e.mjs";',
    4_000,
    options,
  );

  const blocked = preEvidence(state, "Get-Content src/e.mjs", 5_000, options);
  assert.equal(blocked.output?.decision, "block");
  assert.equal(state.watchdog.investigationCreditsUsed, 2);
});

test("linked duplicate stable reads remain blocked before investigation credit", () => {
  let state = runEvidence(
    {},
    "Get-Content src/a.mjs",
    'export { b } from "./b.mjs";',
    1_000,
  );
  state = runEvidence(
    state,
    "Get-Content src/b.mjs",
    'export { c } from "./c.mjs";',
    2_000,
  );

  const duplicate = preEvidence(state, "Get-Content src/b.mjs", 3_000);
  assert.equal(duplicate.output?.decision, "block");
  assert.match(duplicate.output?.reason || "", /Duplicate read blocked/);
});

test("Codex App Server receives the same bounded dependency-following evidence credit", () => {
  const watchdog = createProgressWatchdog({
    evidenceSoftLimit: 2,
    evidenceHardLimit: 3,
  });
  const context = { interruptedTurns: new Set() };

  runAppServerEvidence(
    watchdog,
    context,
    "Get-Content src/authority-entrypoint.mjs",
    'import { resolveStoredCredential } from "./stored-credential-resolver.mjs";',
    1,
  );
  runAppServerEvidence(
    watchdog,
    context,
    "Get-Content src/stored-credential-resolver.mjs",
    'import { refreshManagedToken } from "./managed-token-refresh.mjs";',
    2,
  );
  runAppServerEvidence(
    watchdog,
    context,
    "Get-Content src/managed-token-refresh.mjs",
    'See "../tests/stored-account-retry.test.mjs".',
    3,
  );
  runAppServerEvidence(
    watchdog,
    context,
    "Get-Content tests/stored-account-retry.test.mjs",
    "test(\"stored account refreshes once after 401\", () => {});",
    4,
  );

  assert.equal(watchdog.snapshot().totalEvidenceAttempts, 4);
  assert.equal(watchdog.snapshot().investigationCreditsUsed, 3);
});

test("volatile evidence never receives dependency-following investigation credit", () => {
  const watchdog = createProgressWatchdog({ evidenceSoftLimit: 1, evidenceHardLimit: 2 });
  watchdog.chargeEvidenceAttempt();
  watchdog.recordEvidenceResult({
    toolName: "commandExecution",
    input: { command: "Get-Content src/a.mjs" },
    volatility: "stable",
    response: 'export { b } from "./b.mjs";',
  });

  assert.equal(
    watchdog.prepareEvidenceAttempt({
      toolName: "commandExecution",
      input: { command: "Get-Content src/b.mjs" },
      volatility: "volatile",
    }),
    false,
  );
  const blocked = watchdog.chargeEvidenceAttempt();
  assert.equal(blocked.action, "block");
  assert.equal(blocked.reason, "evidence_budget_exhausted");
  assert.equal(watchdog.snapshot().investigationCreditsUsed, 0);
});

test("state progress clears dependency targets and resets the investigation credit generation", () => {
  const watchdog = createProgressWatchdog({ evidenceSoftLimit: 2, evidenceHardLimit: 3 });
  watchdog.chargeEvidenceAttempt();
  watchdog.recordEvidenceResult({
    toolName: "commandExecution",
    input: { command: "Get-Content src/a.mjs" },
    volatility: "stable",
    response: 'export { b } from "./b.mjs";',
  });
  assert.equal(
    watchdog.prepareEvidenceAttempt({
      toolName: "commandExecution",
      input: { command: "Get-Content src/b.mjs" },
      volatility: "stable",
    }),
    true,
  );
  assert.equal(watchdog.chargeEvidenceAttempt().investigationProgress, true);
  assert.equal(watchdog.snapshot().investigationCreditsUsed, 1);

  watchdog.recordStateProgress("test_state_progress");
  const reset = watchdog.snapshot();
  assert.equal(reset.investigationCreditsUsed, 0);
  assert.deepEqual(reset.investigationReferencedTargets, []);
});
