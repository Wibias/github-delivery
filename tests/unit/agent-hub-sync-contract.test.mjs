import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runBootstrapDoctor } from "../../scripts/lib/bootstrap-maintenance.mjs";
import { evaluateCodexHook } from "../../scripts/lib/codex-watchdog-hook.mjs";

test("npm package includes the Agent Hub native Codex memory drift guard", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.ok(
    pkg.files.includes("scripts/lib/codex-native-memory-drift.mjs"),
    "expected codex-native-memory-drift.mjs in the published package",
  );
});

test("Agent Hub native Codex memory drift guard classifies isolated state", async () => {
  const module = await import("../../scripts/lib/codex-native-memory-drift.mjs").catch(() => null);
  assert.ok(module, "expected scripts/lib/codex-native-memory-drift.mjs");

  const result = module.evaluateCodexNativeMemoryDrift({
    configText: [
      "[features]",
      "memories = false",
      "",
      "[memories]",
      "use_memories = false",
      "generate_memories = false",
      "",
    ].join("\n"),
    hooks: {
      hooks: {
        UserPromptSubmit: [{
          hooks: [{
            type: "command",
            command: "node C:\\repo\\memory-engine\\adapters\\codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall",
          }],
        }],
      },
    },
  });

  assert.equal(result.applicable, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, "isolated");
});

test("doctor exposes Agent Hub native-memory drift state", async () => {
  const target = resolve("C:/fixture/github-delivery");
  const drift = {
    applicable: true,
    ok: false,
    status: "drift_detected",
    agentHubHookConfigured: true,
    settings: {
      featureEnabled: false,
      useMemories: true,
      generateMemories: false,
    },
    reasons: ["memories.use_memories_not_false"],
  };

  const report = await runBootstrapDoctor({
    target,
    codexHome: resolve("C:/fixture/.codex"),
    dependencies: {
      checkBootstrapEnvironment: () => ({ ok: true }),
      discoverInstallations: () => [{ valid: true, target, version: "1.7.1" }],
      readInstalledManifest: () => ({ kind: "fixture" }),
      compareInstalledManifest: () => ({ clean: true, modifications: [] }),
      readUserConfig: () => ({ source: "fixture", config: { schemaVersion: 1, authorityMode: "off" } }),
      readInstalledAuthorityHost: () => ({ supported: false, installed: false, legacy: false, version: null, sourceCommit: null }),
      readActivationReceipt: () => ({ mode: "hooks", hookTrustVerified: true }),
      latestRelease: async () => ({ tag_name: "v1.7.1" }),
      runtimeVersion: () => "1.7.1",
      readCodexNativeMemoryDrift: async () => drift,
    },
  });

  assert.deepEqual(report.nativeCodexMemory, drift);
});

test("Agent Hub watchdog defaults warn at 32 and block at 64 evidence reads", () => {
  let state = {};
  let warning = null;
  let blocked = null;

  for (let index = 1; index <= 64; index += 1) {
    const result = evaluateCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "agent-hub-sync",
        turn_id: "watchdog-defaults",
        tool_name: "mcp__github__fetch_file",
        tool_input: { path: `unique-${index}.md` },
      },
      state,
      { now: index * 1_000 },
    );
    state = result.state;
    if (index === 32) warning = result.output;
    if (index === 64) blocked = result.output;
  }

  assert.equal(warning?.decision, undefined);
  assert.equal(warning?.hookSpecificOutput?.hookEventName, "PreToolUse");
  assert.match(warning?.hookSpecificOutput?.additionalContext || "", /evidence|synthesi[sz]e/i);
  assert.equal(blocked?.decision, "block");
  assert.match(blocked?.reason || "", /evidence/i);
});
