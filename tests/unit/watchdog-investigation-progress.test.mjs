import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

function runEvidence(state, command, response, now) {
  const pre = evaluateCodexHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    },
    state,
    { now, evidenceSoftLimit: 2, evidenceHardLimit: 3 },
  );
  assert.equal(pre.output?.decision, undefined, pre.output?.reason);
  return evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_response: response,
    },
    pre.state,
    { now: now + 1, evidenceSoftLimit: 2, evidenceHardLimit: 3 },
  ).state;
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
});
