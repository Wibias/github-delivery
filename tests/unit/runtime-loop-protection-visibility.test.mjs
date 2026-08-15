import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../scripts/github-delivery-cli.mjs";
import { buildRuntimeCapabilities } from "../../scripts/lib/runtime-capabilities.mjs";

function writableBuffer() {
  let text = "";
  return {
    write(chunk) {
      text += String(chunk);
    },
    toString() {
      return text;
    },
  };
}

function capability(mode) {
  return buildRuntimeCapabilities({
    probes: { node: true },
    declarations: { progressWatchdog: mode },
  });
}

test("runtime capabilities expose full, partial, and off agent-loop protection levels", () => {
  assert.deepEqual(capability("stream").runtime.agentLoopProtection, {
    level: "full",
    mode: "stream",
    canInterruptInFlight: true,
  });
  assert.deepEqual(capability("hooks").runtime.agentLoopProtection, {
    level: "partial",
    mode: "hooks",
    canInterruptInFlight: false,
  });
  assert.deepEqual(capability("none").runtime.agentLoopProtection, {
    level: "off",
    mode: "none",
    canInterruptInFlight: false,
  });
});

test("doctor labels stream protection as Full (STREAM)", async () => {
  const stdout = writableBuffer();
  await main(["doctor"], {
    stdout,
    runBootstrap: async () => ({
      action: "doctor",
      environment: { ok: true, node: { ok: true, version: "26.7.0" }, git: { ok: true }, gh: { ok: true }, ghAuth: { ok: true } },
      installed: { ok: true, version: "0.7.1" },
      integrity: { ok: true, clean: true },
      activation: { mode: "stream", hooksConfigured: true, hookTrustVerified: true },
    }),
  });
  const text = stdout.toString();
  assert.match(text, /Agent loops\s+Full \(STREAM\)/);
  assert.match(text, /In-flight\s+interrupt enabled/);
});

test("doctor labels hook-only protection as Partial (HOOKS) without implying in-flight interruption", async () => {
  const stdout = writableBuffer();
  await main(["doctor"], {
    stdout,
    runBootstrap: async () => ({
      action: "doctor",
      environment: { ok: true, node: { ok: true, version: "26.7.0" }, git: { ok: true }, gh: { ok: true }, ghAuth: { ok: true } },
      installed: { ok: true, version: "0.7.1" },
      integrity: { ok: true, clean: true },
      activation: { mode: "hooks", hooksConfigured: true, hookTrustVerified: true },
    }),
  });
  const text = stdout.toString();
  assert.match(text, /Agent loops\s+Partial \(HOOKS\)/);
  assert.match(text, /In-flight\s+not available/);
  assert.doesNotMatch(text, /Full \(STREAM\)/);
});

test("doctor labels missing runtime protection as Off (NONE)", async () => {
  const stdout = writableBuffer();
  await main(["doctor"], {
    stdout,
    runBootstrap: async () => ({
      action: "doctor",
      environment: { ok: true, node: { ok: true, version: "26.7.0" }, git: { ok: true }, gh: { ok: true }, ghAuth: { ok: true } },
      installed: { ok: true, version: "0.7.1" },
      integrity: { ok: true, clean: true },
      activation: { mode: "none", degradationReason: "streaming_interruption_unavailable", hooksConfigured: false, hookTrustVerified: false },
    }),
  });
  const text = stdout.toString();
  assert.match(text, /Agent loops\s+Off \(NONE\)/);
  assert.match(text, /In-flight\s+not available/);
});

test("setup surfaces the effective agent-loop protection level", async () => {
  const stdout = writableBuffer();
  await main(["setup"], {
    stdout,
    runBootstrap: async () => ({
      action: "setup",
      status: "ready",
      watchdog: "hooks",
    }),
  });
  assert.match(stdout.toString(), /Agent loops\s+Partial \(HOOKS\)/);
});
