import assert from "node:assert/strict";
import test from "node:test";

import {
  addReviewCandidate,
  createCandidateLedger,
  finalizeCandidateLedgerForVerdict,
  recordCandidateArbitration,
  recordCandidateValidation,
} from "../../scripts/lib/review-candidate-ledger.mjs";

function settled(verdict = "dismissed") {
  const ledger = createCandidateLedger({
    repo: "owner/repo",
    baseSha: "base",
    headSha: "head",
    runId: "review-1",
  });
  addReviewCandidate(ledger, {
    findingId: "BUG-1",
    axis: "bug",
    category: "compatibility",
    producer: "finder",
    claim: "The compatibility test is a merge blocker.",
    severity: "high",
    confidence: "high",
    evidence: [{ kind: "source", ref: "tests/test_device.py:213" }],
  });
  recordCandidateValidation(ledger, "BUG-1", {
    validator: "challenger",
    verdict: verdict === "confirmed" ? "accept" : "reject",
    evidence: [{ kind: "runtime", ref: "minimum-version-check" }],
  });
  recordCandidateArbitration(ledger, "BUG-1", {
    arbiter: "arbiter",
    verdict,
    evidence: [{ kind: "adjudication", ref: "final-evidence" }],
  });
  return ledger;
}

test("arbitration is terminal and later prose-era revalidation cannot flip it", () => {
  const ledger = settled("dismissed");
  assert.throws(
    () => recordCandidateValidation(ledger, "BUG-1", {
      validator: "late-validator",
      verdict: "accept",
      evidence: [{ kind: "claim", ref: "later prose says blocker" }],
    }),
    /terminal/i,
  );
  assert.throws(
    () => recordCandidateArbitration(ledger, "BUG-1", {
      arbiter: "second-arbiter",
      verdict: "confirmed",
      evidence: [{ kind: "claim", ref: "later prose says blocker" }],
    }),
    /terminal/i,
  );
});

test("final verdict state derives only from terminal ledger dispositions", () => {
  const dismissed = finalizeCandidateLedgerForVerdict(settled("dismissed"), "head");
  assert.deepEqual(dismissed.confirmed, []);
  assert.deepEqual(dismissed.dismissed, ["BUG-1"]);
  assert.equal(dismissed.ready, true);

  const confirmed = finalizeCandidateLedgerForVerdict(settled("confirmed"), "head");
  assert.deepEqual(confirmed.confirmed, ["BUG-1"]);
  assert.deepEqual(confirmed.dismissed, []);
  assert.equal(confirmed.ready, true);
});

test("unsettled, manual-review, and stale-head ledgers cannot drive a final verdict", () => {
  const ledger = createCandidateLedger({ repo: "owner/repo", baseSha: "base", headSha: "head", runId: "review-1" });
  addReviewCandidate(ledger, {
    findingId: "BUG-1",
    axis: "bug",
    producer: "finder",
    claim: "Potential regression.",
    evidence: [{ kind: "source", ref: "src/a.js:1" }],
  });

  assert.equal(finalizeCandidateLedgerForVerdict(ledger, "head").ready, false);
  assert.throws(() => finalizeCandidateLedgerForVerdict(ledger, "other"), /stale candidate ledger/);
});
