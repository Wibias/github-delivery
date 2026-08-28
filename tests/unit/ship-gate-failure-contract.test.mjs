import assert from "node:assert/strict";
import test from "node:test";

import { shipGateFailureOutput } from "../../scripts/lib/ship-gate-failure.mjs";

test("live evidence capture failure emits a machine-readable terminal unknown", () => {
  const output = shipGateFailureOutput(
    new Error(
      "snapshot_rules_boundary_incomplete: HTTP 403: Upgrade to GitHub Pro to use repository rules",
    ),
    { stage: "live_snapshot_capture" },
  );

  assert.equal(output.kind, "github-delivery/ship-gate");
  assert.equal(output.decision, "unknown");
  assert.equal(output.ready, false);
  assert.equal(output.blocked, false);
  assert.equal(output.unknown, true);
  assert.equal(output.complete, false);
  assert.equal(output.authoritative, false);
  assert.equal(output.evidenceMode, "live_capture");
  assert.deepEqual(output.unknowns, ["ship_gate_evidence_capture_failed"]);
  assert.equal(output.failure.retryable, false);
  assert.equal(output.failure.classification, "github_capability_or_permission_error");
  assert.match(output.failure.message, /403.*GitHub Pro/i);
});
