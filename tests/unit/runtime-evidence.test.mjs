import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeEvidenceSession,
  recordRuntimeAttempt,
  summarizeRuntimeEvidence,
} from "../../scripts/lib/runtime-evidence.mjs";

function session() {
  return createRuntimeEvidenceSession({
    target: "issue #90 payment callback",
    repo: "acme/payments",
    commitSha: "a".repeat(40),
    environment: {
      runtime: "node 24",
      platform: "linux",
      fixture: "local test database",
    },
  });
}

test("reproduced requires expected, actual, trigger, and concrete evidence", () => {
  const state = session();
  assert.throws(() => recordRuntimeAttempt(state, {
    id: "attempt-1",
    status: "reproduced",
    trigger: "POST duplicate callback",
    expected: "one charge",
    actual: "two charges",
    evidence: [],
  }), /reproduced.*evidence/i);

  recordRuntimeAttempt(state, {
    id: "attempt-1",
    status: "reproduced",
    trigger: "POST duplicate callback",
    expected: "one charge",
    actual: "two charges",
    evidence: [{ kind: "test", ref: "tests/callback.test.mjs:42" }],
  });
  const summary = summarizeRuntimeEvidence(state);
  assert.equal(summary.verdict, "reproduced");
  assert.equal(summary.reproducedAttempts, 1);
});

test("not reproduced never becomes fixed", () => {
  const state = session();
  recordRuntimeAttempt(state, {
    id: "attempt-1",
    status: "not-reproduced",
    trigger: "POST duplicate callback",
    expected: "one charge",
    actual: "one charge in local fixture",
    evidence: [{ kind: "log", ref: "artifacts/run-1.log" }],
  });

  const summary = summarizeRuntimeEvidence(state);
  assert.equal(summary.verdict, "not-reproduced");
  assert.equal(summary.fixed, false);
});

test("blocked and inconclusive attempts keep the runtime verdict partial", () => {
  const state = session();
  recordRuntimeAttempt(state, {
    id: "attempt-1",
    status: "not-reproduced",
    trigger: "run local fixture",
    expected: "timeout",
    actual: "success",
    evidence: [{ kind: "log", ref: "artifacts/local.log" }],
  });
  recordRuntimeAttempt(state, {
    id: "attempt-2",
    status: "blocked",
    trigger: "run against staging fixture",
    blocker: "staging credential unavailable",
    evidence: [{ kind: "error", ref: "credential lookup failed" }],
  });

  const summary = summarizeRuntimeEvidence(state);
  assert.equal(summary.verdict, "partial");
  assert.deepEqual(summary.blockers, ["staging credential unavailable"]);
});

test("attempt ids are unique and every attempt carries evidence", () => {
  const state = session();
  recordRuntimeAttempt(state, {
    id: "attempt-1",
    status: "inconclusive",
    trigger: "replay production-shaped payload",
    blocker: "timing result overlaps baseline",
    evidence: [{ kind: "measurement", ref: "20 repeated samples" }],
  });
  assert.throws(() => recordRuntimeAttempt(state, {
    id: "attempt-1",
    status: "inconclusive",
    trigger: "again",
    blocker: "same",
    evidence: [{ kind: "measurement", ref: "sample" }],
  }), /duplicate runtime attempt/);
  assert.throws(() => recordRuntimeAttempt(state, {
    id: "attempt-2",
    status: "blocked",
    trigger: "try integration",
    blocker: "dependency unavailable",
    evidence: [],
  }), /evidence/i);
});

test("session is commit-bound", () => {
  assert.throws(() => createRuntimeEvidenceSession({
    target: "issue #90",
    repo: "acme/payments",
    commitSha: "not-a-sha",
    environment: { runtime: "node" },
  }), /commitSha/);
});

test("reproduced dominates partial attempts but residual blockers remain visible", () => {
  const state = session();
  recordRuntimeAttempt(state, {
    id: "attempt-1",
    status: "blocked",
    trigger: "staging replay",
    blocker: "staging unavailable",
    evidence: [{ kind: "error", ref: "503 staging" }],
  });
  recordRuntimeAttempt(state, {
    id: "attempt-2",
    status: "reproduced",
    trigger: "local deterministic integration test",
    expected: "single state transition",
    actual: "transition applied twice",
    evidence: [{ kind: "test", ref: "tests/state.test.mjs:55" }],
  });

  const summary = summarizeRuntimeEvidence(state);
  assert.equal(summary.verdict, "reproduced");
  assert.deepEqual(summary.blockers, ["staging unavailable"]);
});
