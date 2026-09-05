import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppServerWatchdogRouter } from "../../scripts/lib/codex-app-server-watchdog-proxy.mjs";

const debugTraceModuleUrl = new URL("../../scripts/lib/codex-debug-trace.mjs", import.meta.url);

async function loadDebugTraceModule() {
  try {
    return await import(`${debugTraceModuleUrl.href}?test=${Date.now()}-${Math.random()}`);
  } catch {
    return null;
  }
}

test("Codex debug tracing is opt-in and disabled by default", async () => {
  const module = await loadDebugTraceModule();
  assert.ok(module, "codex debug trace module is missing");
  assert.equal(module.debugTraceEnabled({}), false);
  assert.equal(module.debugTraceEnabled({ GITHUB_DELIVERY_DEBUG_TRACE: "0" }), false);
  assert.equal(module.debugTraceEnabled({ GITHUB_DELIVERY_DEBUG_TRACE: "1" }), true);
  assert.equal(module.debugTraceEnabled({ GITHUB_DELIVERY_DEBUG_TRACE: "true" }), true);
});

test("router debug trace keeps visible reasoning summaries but excludes tool payloads", () => {
  const trace = [];
  const router = createAppServerWatchdogRouter({
    internalRequestIdPrefix: "gd-debug-trace",
    onDebugTrace: (event) => trace.push(event),
  });

  router.onServerMessage({
    method: "item/reasoning/summaryTextDelta",
    params: {
      threadId: "thr-debug",
      turnId: "turn-debug",
      itemId: "reasoning-debug",
      delta: "The checkpoint path is missing, so I am checking the controller.",
    },
  });
  router.onServerMessage({
    method: "item/started",
    params: {
      threadId: "thr-debug",
      turnId: "turn-debug",
      item: {
        id: "tool-debug",
        type: "commandExecution",
        command: "gh api /repos/private/secret --input super-secret.json",
        cwd: "C:/Users/private/repo",
      },
    },
  });

  assert.equal(trace.length, 2);
  assert.equal(trace[0].type, "reasoning_summary_delta");
  assert.equal(
    trace[0].text,
    "The checkpoint path is missing, so I am checking the controller.",
  );
  assert.equal(trace[1].type, "item_started");
  assert.equal(trace[1].itemType, "commandExecution");
  assert.equal(trace[1].itemId, "tool-debug");
  assert.doesNotMatch(JSON.stringify(trace), /super-secret|private\/secret|C:\/Users\/private/);
});

test("debug recorder creates no files while disabled and bounded JSONL while enabled", async () => {
  const module = await loadDebugTraceModule();
  assert.ok(module, "codex debug trace module is missing");
  const stateDir = mkdtempSync(join(tmpdir(), "gd-debug-trace-"));

  const disabled = module.createCodexDebugTraceRecorder({ env: {}, stateDir });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.path, null);
  disabled.record({ type: "reasoning_summary_delta", text: "must not persist" });
  disabled.close();
  assert.deepEqual(readdirSync(stateDir), []);

  const enabled = module.createCodexDebugTraceRecorder({
    env: { GITHUB_DELIVERY_DEBUG_TRACE: "1" },
    stateDir,
    now: () => new Date("2026-09-05T06:00:00.000Z"),
    pid: 4242,
    maxBytes: 1024,
  });
  assert.equal(enabled.enabled, true);
  assert.match(enabled.path, /debug-traces/);
  enabled.record({
    schemaVersion: 1,
    kind: "github-delivery/codex-debug-trace-event",
    type: "reasoning_summary_delta",
    text: "visible summary",
  });
  enabled.close();

  const persisted = readFileSync(enabled.path, "utf8");
  assert.match(persisted, /visible summary/);
  assert.match(persisted, /github-delivery\/codex-debug-trace-event/);
});
