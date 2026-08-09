import assert from "node:assert/strict";
import test from "node:test";

import {
  createSnapshotEnvelope,
  snapshotIntegritySha256,
  summarizeSources,
} from "../../scripts/lib/snapshot-schema.mjs";

test("required complete sources produce a sealed complete snapshot", () => {
  const snapshot = createSnapshotEnvelope({
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid: "abc",
    capturedAt: "2026-08-01T00:00:00.000Z",
    sources: {
      pr: { required: true, complete: true },
      codeowners: {
        required: false,
        complete: false,
        error: "not configured",
      },
    },
  });
  assert.equal(snapshot.complete, true);
  assert.match(snapshot.snapshotId, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.snapshotId, snapshot.integritySha256);
  assert.equal(snapshot.integritySha256, snapshotIntegritySha256(snapshot));
});

test("an incomplete required source makes the snapshot incomplete", () => {
  const summary = summarizeSources({
    pr: { required: true, complete: true },
    reviewThreads: {
      required: true,
      complete: false,
      error: "truncated",
    },
  });
  assert.deepEqual(summary.incomplete, [
    { source: "reviewThreads", error: "truncated" },
  ]);
});

test("snapshot identity is deterministic for the same complete payload", () => {
  const args = {
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid: "abc",
    capturedAt: "2026-08-01T00:00:00.000Z",
    evidence: { pullRequest: { headRefOid: "abc", reviewDecision: "APPROVED" } },
  };
  assert.equal(
    createSnapshotEnvelope(args).snapshotId,
    createSnapshotEnvelope(args).snapshotId,
  );
});

test("snapshot identity changes when authoritative evidence changes", () => {
  const base = {
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid: "abc",
    capturedAt: "2026-08-01T00:00:00.000Z",
  };
  const approved = createSnapshotEnvelope({
    ...base,
    evidence: { pullRequest: { headRefOid: "abc", reviewDecision: "APPROVED" } },
  });
  const changesRequested = createSnapshotEnvelope({
    ...base,
    evidence: {
      pullRequest: { headRefOid: "abc", reviewDecision: "CHANGES_REQUESTED" },
    },
  });
  assert.notEqual(approved.snapshotId, changesRequested.snapshotId);
});
