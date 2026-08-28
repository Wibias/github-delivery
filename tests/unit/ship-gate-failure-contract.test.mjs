import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SHIP_GATE = fileURLToPath(new URL("../../scripts/ship-gate.mjs", import.meta.url));

test("ship-gate emits a machine-readable terminal unknown when evidence capture fails", () => {
  const missingSnapshot = fileURLToPath(
    new URL("../fixtures/ship-gate/definitely-missing-snapshot.json", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [SHIP_GATE, "owner/repo", "1", "--snapshot", missingSnapshot],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, "github-delivery/ship-gate");
  assert.equal(output.decision, "unknown");
  assert.equal(output.ready, false);
  assert.equal(output.blocked, false);
  assert.equal(output.unknown, true);
  assert.equal(output.complete, false);
  assert.deepEqual(output.unknowns, ["ship_gate_evidence_capture_failed"]);
  assert.equal(output.failure.retryable, false);
  assert.equal(output.failure.classification, "local_input_error");
  assert.match(output.failure.message, /ENOENT|no such file/i);
});
