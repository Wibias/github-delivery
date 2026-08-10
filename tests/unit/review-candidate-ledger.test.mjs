import assert from "node:assert/strict";
import test from "node:test";

import {
  addReviewCandidate,
  assertCandidateLedgerHead,
  candidateLedgerSummary,
  createCandidateLedger,
  enqueueValidationDiscovery,
  recordCandidateArbitration,
  recordCandidateValidation,
} from "../../scripts/lib/review-candidate-ledger.mjs";

function ledger() {
  return createCandidateLedger({ repo: "owner/repo", baseSha: "base", headSha: "head", runId: "run-1" });
}

function candidate(overrides = {}) {
  return {
    findingId: "BUG-1",
    axis: "bug",
    category: "logic",
    producer: "finder-a",
    claim: "An empty input reaches the success branch.",
    location: { file: "src/check.mjs", lines: "10-12" },
    runtimeTrigger: "call check([])",
    severity: "medium",
    confidence: "medium",
    evidence: [{ kind: "source", ref: "src/check.mjs:10-12" }],
    ...overrides,
  };
}

test("adds candidates with append-only history and head binding", () => {
  const state = ledger();
  const result = addReviewCandidate(state, candidate());
  assert.equal(result.status, "added");
  assert.equal(state.candidates[0].state, "candidate");
  assert.equal(state.history[0].sequence, 1);
  assert.equal(assertCandidateLedgerHead(state, "head"), true);
  assert.throws(() => assertCandidateLedgerHead(state, "other"), /stale candidate ledger/);
});

test("deduplicates equivalent claims while retaining producer provenance", () => {
  const state = ledger();
  addReviewCandidate(state, candidate());
  const result = addReviewCandidate(state, candidate({
    findingId: "BUG-2",
    producer: "bugbot",
    evidence: [{ kind: "tool", ref: "bugbot:42" }],
  }));

  assert.equal(result.status, "deduplicated");
  assert.equal(state.candidates.length, 1);
  assert.deepEqual(state.candidates[0].producers, ["finder-a", "bugbot"]);
  assert.equal(state.candidates[0].evidence.length, 2);
  assert.equal(state.history.at(-1).type, "candidate-deduplicated");
});

test("producer cannot validate its own discovery", () => {
  const state = ledger();
  addReviewCandidate(state, candidate());
  assert.throws(
    () => recordCandidateValidation(state, "BUG-1", {
      validator: "finder-a",
      verdict: "accept",
      evidence: [{ kind: "runtime", ref: "repro" }],
    }),
    /cannot validate its own discovery/,
  );
});

test("validator cannot self-confirm a new claim inside validation", () => {
  const state = ledger();
  addReviewCandidate(state, candidate());
  assert.throws(
    () => recordCandidateValidation(state, "BUG-1", {
      validator: "challenger-b",
      verdict: "accept",
      evidence: [{ kind: "source", ref: "src/check.mjs:10" }],
      newFinding: { claim: "another bug" },
    }),
    /enqueue it as a new candidate/,
  );
});

test("validation discoveries become new candidates requiring another validator", () => {
  const state = ledger();
  addReviewCandidate(state, candidate());
  const result = enqueueValidationDiscovery(state, "BUG-1", candidate({
    findingId: "BUG-2",
    claim: "A sibling path drops the error.",
    location: { file: "src/sibling.mjs", lines: "20-22" },
  }), "challenger-b");

  assert.equal(result.status, "added");
  const child = state.candidates.find((item) => item.findingId === "BUG-2");
  assert.equal(child.producer, "challenger-b");
  assert.equal(child.parentFindingId, "BUG-1");
  assert.throws(
    () => recordCandidateValidation(state, "BUG-2", {
      validator: "challenger-b",
      verdict: "accept",
      evidence: [{ kind: "runtime", ref: "repro-2" }],
    }),
    /cannot validate its own discovery/,
  );
});

test("independent validation and arbitration produce a confirmed candidate", () => {
  const state = ledger();
  addReviewCandidate(state, candidate());
  const validated = recordCandidateValidation(state, "BUG-1", {
    validator: "challenger-b",
    verdict: "accept",
    evidence: [{ kind: "runtime", ref: "repro" }],
  });
  assert.equal(validated.state, "validated");

  assert.throws(
    () => recordCandidateArbitration(state, "BUG-1", {
      arbiter: "challenger-b",
      verdict: "confirmed",
      evidence: [{ kind: "source", ref: "independent-read" }],
    }),
    /must be independent/,
  );

  const arbitrated = recordCandidateArbitration(state, "BUG-1", {
    arbiter: "arbiter-c",
    verdict: "confirmed",
    evidence: [{ kind: "source", ref: "independent-read" }],
  });
  assert.equal(arbitrated.state, "validated");
  assert.equal(state.history.at(-1).type, "candidate-arbitrated");
});

test("summary keeps unresolved candidates visible", () => {
  const state = ledger();
  addReviewCandidate(state, candidate());
  addReviewCandidate(state, candidate({
    findingId: "SEC-1",
    axis: "security",
    producer: "finder-security",
    claim: "User input reaches a shell sink.",
    location: { file: "src/run.mjs", lines: "4-5" },
    runtimeTrigger: "submit crafted command",
  }));
  recordCandidateValidation(state, "SEC-1", {
    validator: "challenger-security",
    verdict: "reject",
    evidence: [{ kind: "source", ref: "escaping-before-sink" }],
  });

  const summary = candidateLedgerSummary(state);
  assert.equal(summary.candidateCount, 2);
  assert.deepEqual(summary.unresolved, ["BUG-1"]);
  assert.equal(summary.byState.rejected, 1);
});

test("requires evidence and unique finding ids", () => {
  const state = ledger();
  assert.throws(() => addReviewCandidate(state, candidate({ evidence: [] })), /at least one evidence item/);
  addReviewCandidate(state, candidate());
  assert.throws(() => addReviewCandidate(state, candidate()), /duplicate finding id/);
});
