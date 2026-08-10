import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRefactorContractCard } from "../../scripts/lib/refactor-contract-card.mjs";

const complete = {
  candidateId: "SIM-1",
  behavior: ["same visible output for valid input"],
  apiAndData: ["no API/schema changes"],
  persistence: ["no persistence format changes"],
  performanceAndResources: ["same asymptotic behavior and file-read count"],
  securityAndAuthorization: ["same authorization checks"],
  compatibility: ["Node 22/24 unchanged"],
  errorsAndLogs: ["same error class/message contract"],
  sideEffects: ["same GitHub write count/order"],
  timingAndConcurrency: ["same lock/ordering semantics"],
  tests: [
    { id: "unit-1", protects: "same visible output for valid input", wouldFailIfBroken: true },
  ],
};

test("complete contract with honest tests is eligible", () => {
  const result = evaluateRefactorContractCard(complete);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.blockers, []);
});

test("missing contract dimensions block simplification", () => {
  const result = evaluateRefactorContractCard({ ...complete, securityAndAuthorization: [] });
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("missing-contract:securityAndAuthorization"));
});

test("tests that would not fail for broken behavior do not count as protection", () => {
  const result = evaluateRefactorContractCard({
    ...complete,
    tests: [{ id: "unit-1", protects: "same visible output for valid input", wouldFailIfBroken: false }],
  });
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("dishonest-or-vacuous-test:unit-1"));
});

test("poorly documented important behavior requires characterization evidence", () => {
  const result = evaluateRefactorContractCard({
    ...complete,
    behaviorKnowledge: "poorly-documented-important",
    characterizationEvidence: [],
  });
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("characterization-evidence-required"));
});

test("characterization evidence can satisfy poorly documented behavior gate", () => {
  const result = evaluateRefactorContractCard({
    ...complete,
    behaviorKnowledge: "poorly-documented-important",
    characterizationEvidence: [{ kind: "test", ref: "tests/characterization.test.mjs" }],
  });
  assert.equal(result.eligible, true);
});

test("unknown equivalence explicitly blocks application", () => {
  const result = evaluateRefactorContractCard({
    ...complete,
    unknowns: ["whether callback order is externally observed"],
  });
  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes("unresolved-equivalence-unknowns"));
});
