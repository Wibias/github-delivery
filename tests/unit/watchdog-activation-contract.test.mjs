import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  activationReceiptPath,
  readActivationReceipt,
  selectWatchdogMode,
  writeActivationReceipt,
} from "../../scripts/lib/watchdog-activation.mjs";

test("watchdog selection prefers stream, then trusted hooks, then truthful degradation", () => {
  assert.deepEqual(
    selectWatchdogMode({
      host: "codex",
      streamLaunchControlled: true,
      lifecycleHooksSupported: true,
      hookTrustVerified: false,
    }),
    { mode: "stream", degradationReason: null },
  );
  assert.deepEqual(
    selectWatchdogMode({
      host: "codex",
      streamLaunchControlled: false,
      lifecycleHooksSupported: true,
      hookTrustVerified: true,
    }),
    { mode: "hooks", degradationReason: "streaming_interruption_unavailable" },
  );
  assert.deepEqual(
    selectWatchdogMode({
      host: "codex",
      streamLaunchControlled: false,
      lifecycleHooksSupported: true,
      hookTrustVerified: false,
    }),
    { mode: "none", degradationReason: "hook_trust_required" },
  );
  assert.deepEqual(
    selectWatchdogMode({ host: "unknown", streamLaunchControlled: false, lifecycleHooksSupported: false }),
    { mode: "none", degradationReason: "progress_watchdog_unavailable" },
  );
});

test("activation receipt is dry-run safe, non-sensitive, and idempotent", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "gd-activation-receipt-"));
  const path = activationReceiptPath({ codexHome });
  const clock = () => new Date("2026-08-11T06:30:00.000Z");
  const desired = {
    codexHome,
    mode: "hooks",
    degradationReason: "streaming_interruption_unavailable",
    hooksConfigured: true,
    hookTrustVerified: true,
  };

  const planned = writeActivationReceipt({ ...desired, apply: false, now: clock });
  assert.equal(planned.changed, true);
  assert.equal(planned.applied, false);
  assert.equal(existsSync(path), false);

  const applied = writeActivationReceipt({ ...desired, apply: true, now: clock });
  assert.equal(applied.applied, true);
  const raw = readFileSync(path, "utf8");
  assert.doesNotMatch(raw, /prompt|conversation|toolInput|tool_input/i);
  assert.deepEqual(readActivationReceipt({ codexHome }), applied.receipt);
  assert.equal(applied.receipt.hooksConfigured, true);
  assert.equal(applied.receipt.hookTrustVerified, true);

  const repeated = writeActivationReceipt({
    ...desired,
    apply: true,
    now: () => new Date("2026-08-11T07:30:00.000Z"),
  });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.applied, false);
  assert.equal(repeated.receipt.updatedAt, "2026-08-11T06:30:00.000Z");
});
