import assert from "node:assert/strict";
import test from "node:test";

import { parseFixtureGateResult } from "../../scripts/lib/live-fixture-gate-result.mjs";

test("accepts blocked and unknown ship-gate JSON on their documented exit codes", () => {
  assert.deepEqual(
    parseFixtureGateResult({
      status: 1,
      stdout: JSON.stringify({ ready: false, blocked: true }),
      stderr: "",
    }),
    {
      decision: "blocked",
      raw: { ready: false, blocked: true },
    },
  );

  assert.deepEqual(
    parseFixtureGateResult({
      status: 2,
      stdout: JSON.stringify({ ready: false, blocked: false }),
      stderr: "diagnostic warning",
    }),
    {
      decision: "unknown",
      raw: { ready: false, blocked: false },
    },
  );
});

test("preserves the real ship-gate failure when stdout is empty", () => {
  assert.throws(
    () => parseFixtureGateResult({
      status: 2,
      stdout: "",
      stderr: "policy GraphQL request failed: forbidden",
    }),
    (error) => {
      assert.equal(error.code, "fixture_gate_no_output");
      assert.match(error.message, /policy GraphQL request failed: forbidden/);
      assert.match(error.message, /exit 2/);
      return true;
    },
  );
});

test("rejects invalid or contradictory ship-gate JSON with context", () => {
  assert.throws(
    () => parseFixtureGateResult({ status: 2, stdout: "{", stderr: "" }),
    (error) => error.code === "fixture_gate_invalid_json",
  );
  assert.throws(
    () => parseFixtureGateResult({
      status: 0,
      stdout: JSON.stringify({ ready: true, blocked: true }),
      stderr: "",
    }),
    (error) => error.code === "fixture_gate_invalid_decision",
  );
});
