import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");

const CURSOR_RUNTIME = [
  "scripts/cursor-trace.mjs",
  "scripts/cursor-with-debug-trace.mjs",
  "scripts/lib/cursor-debug-trace.mjs",
];

const CODEX_RUNTIME = [
  "scripts/codex-trace.mjs",
  "scripts/codex-with-watchdog.mjs",
  "scripts/lib/codex-app-server-watchdog-proxy.mjs",
  "scripts/lib/codex-debug-trace.mjs",
  "scripts/lib/codex-progress-watchdog.mjs",
  "scripts/lib/codex-watchdog-remote-bridge.mjs",
  "scripts/lib/watchdog-investigation-progress.mjs",
  "scripts/lib/agent-progress-watchdog.mjs",
  "scripts/lib/watchdog-progress-classifier.mjs",
  "scripts/lib/watchdog-evidence-registry.mjs",
];

test("package exposes first-class Cursor and Codex trace launchers with their runtime closure", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  assert.equal(pkg.bin?.["cursor-trace"], "scripts/cursor-trace.mjs");
  assert.equal(pkg.bin?.["codex-trace"], "scripts/codex-trace.mjs");

  for (const path of [...CURSOR_RUNTIME, ...CODEX_RUNTIME]) {
    assert(pkg.files?.includes(path), `missing provider trace packed runtime: ${path}`);
  }
});

test("all first-class trace launchers use the same explicit trace opt-in environment", async () => {
  const { buildAgentTraceEnv } = await import("../../scripts/lib/agent-trace-launcher.mjs");

  assert.deepEqual(buildAgentTraceEnv({ PROVIDER_BIN: "custom" }), {
    PROVIDER_BIN: "custom",
    GITHUB_DELIVERY_DEBUG_TRACE: "1",
  });
  assert.equal(
    buildAgentTraceEnv({ GITHUB_DELIVERY_DEBUG_TRACE: "0" }).GITHUB_DELIVERY_DEBUG_TRACE,
    "1",
  );
});
