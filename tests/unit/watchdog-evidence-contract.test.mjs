import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";
import {
  createEvidenceRegistry,
  deriveShellEvidenceDescriptor,
} from "../../scripts/lib/watchdog-evidence-registry.mjs";

test("PostToolUse never replaces a successful large tool response", () => {
  const result = evaluateCodexHook(
    {
      hook_event_name: "PostToolUse",
      session_id: "session-output",
      turn_id: "turn-output",
      tool_name: "Bash",
      tool_input: { command: "Get-Content README.md" },
      tool_response: "x".repeat(12_000),
    },
    {},
    { maxToolOutputChars: 1_000 },
  );

  assert.equal(result.output, null);
});

test("different local filters over one Actions run share one semantic evidence key", () => {
  const first = deriveShellEvidenceDescriptor(
    "gh -R o/r run view 31542325111 --log-failed | Select-String timeout",
  );
  const second = deriveShellEvidenceDescriptor(
    "gh -R o/r run view 31542325111 --log-failed | Select-String SIGSEGV",
  );

  assert.equal(first.key, "github-actions-run:o/r:31542325111");
  assert.equal(second.key, first.key);
  assert.equal(first.authoritative, true);
});

test("owned CI helper declares authoritative coverage instead of looking like opaque shell", () => {
  const descriptor = deriveShellEvidenceDescriptor(
    "node scripts/ci-forensics.mjs o/r 1499 --json",
  );
  assert.deepEqual(descriptor, {
    effect: "evidence",
    key: "pr-ci:o/r:1499",
    authoritative: true,
    covers: ["checks", "failure-origin", "annotations", "failure-log-tail"],
  });
});

test("evidence registry blocks already covered dimensions but permits missing dimensions", () => {
  const registry = createEvidenceRegistry();
  registry.record({
    stateGeneration: 7,
    key: "pr-ci:o/r:1499",
    covers: ["checks", "failure-origin", "annotations", "failure-log-tail"],
    authoritative: true,
  });

  assert.deepEqual(
    registry.decide({
      stateGeneration: 7,
      key: "pr-ci:o/r:1499",
      requires: ["checks", "failure-origin"],
    }),
    {
      action: "block",
      reason: "evidence_already_covered",
      missing: [],
    },
  );

  assert.deepEqual(
    registry.decide({
      stateGeneration: 7,
      key: "pr-ci:o/r:1499",
      requires: ["checks", "artifact-download"],
    }),
    {
      action: "allow",
      missing: ["artifact-download"],
    },
  );
});

test("semantic evidence coverage is invalidated by a relevant state generation change", () => {
  const registry = createEvidenceRegistry();
  registry.record({
    stateGeneration: 3,
    key: "github-actions-run:o/r:99",
    covers: ["failure-log-tail"],
    authoritative: true,
  });

  assert.deepEqual(
    registry.decide({
      stateGeneration: 4,
      key: "github-actions-run:o/r:99",
      requires: ["failure-log-tail"],
    }),
    {
      action: "allow",
      missing: ["failure-log-tail"],
    },
  );
});

test("hook blocks a differently filtered second read after the first run evidence completed", () => {
  const common = {
    session_id: "session-semantic",
    turn_id: "turn-semantic",
    tool_name: "Bash",
  };
  const firstInput = {
    ...common,
    hook_event_name: "PreToolUse",
    tool_input: {
      command: "gh -R o/r run view 31542325111 --log-failed | Select-String timeout",
    },
  };
  const firstPre = evaluateCodexHook(firstInput, {}, { now: 1_000 });
  assert.equal(firstPre.output, null);

  const firstPost = evaluateCodexHook(
    {
      ...firstInput,
      hook_event_name: "PostToolUse",
      tool_response: "failure log evidence",
    },
    firstPre.state,
    { now: 1_100 },
  );
  assert.equal(firstPost.output, null);

  const secondPre = evaluateCodexHook(
    {
      ...common,
      hook_event_name: "PreToolUse",
      tool_input: {
        command: "gh -R o/r run view 31542325111 --log-failed | Select-String SIGSEGV",
      },
    },
    firstPost.state,
    { now: 1_200 },
  );
  assert.equal(secondPre.output?.decision, "block");
  assert.match(secondPre.output?.reason || "", /already covered|authoritative evidence/i);
});
