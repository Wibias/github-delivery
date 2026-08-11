import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeCapabilities } from "../../scripts/lib/runtime-capabilities.mjs";

test("persisted stream activation is reported without an environment declaration", () => {
  const result = buildRuntimeCapabilities({
    probes: { node: true },
    activation: {
      schemaVersion: 1,
      mode: "stream",
      degradationReason: null,
      launcherPath: "/tmp/github-delivery-codex",
    },
    declarations: {},
  });
  assert.equal(result.runtime.progressWatchdog, "stream");
  assert.equal(result.runtime.progressWatchdogAvailable, true);
  assert.equal(result.runtime.progressWatchdogLauncherPath, "/tmp/github-delivery-codex");
  assert.equal(result.fallbacks.contextEconomy, "streaming-watchdog");
});

test("persisted hook activation reports its streaming limitation", () => {
  const result = buildRuntimeCapabilities({
    probes: { node: true },
    activation: {
      schemaVersion: 1,
      mode: "hooks",
      degradationReason: "streaming_interruption_unavailable",
      launcherPath: null,
    },
    declarations: {},
  });
  assert.equal(result.runtime.progressWatchdog, "hooks");
  assert.equal(
    result.runtime.progressWatchdogDegradationReason,
    "streaming_interruption_unavailable",
  );
  assert.equal(result.fallbacks.contextEconomy, "lifecycle-hooks");
});

test("explicit runtime declaration can override persisted activation for controlled hosts", () => {
  const result = buildRuntimeCapabilities({
    probes: { node: true },
    activation: { mode: "hooks", degradationReason: "streaming_interruption_unavailable" },
    declarations: { progressWatchdog: "stream" },
  });
  assert.equal(result.runtime.progressWatchdog, "stream");
});
