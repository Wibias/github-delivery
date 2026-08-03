import assert from "node:assert/strict";
import test from "node:test";

import {
  createSnapshotEnvelope,
  summarizeSources,
} from "../../scripts/lib/snapshot-schema.mjs";

test("required complete sources produce a complete snapshot", () => {
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
  assert.equal(snapshot.snapshotId.length, 64);
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

test("snapshot identity is deterministic for the same capture", () => {
  const args = {
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid: "abc",
    capturedAt: "2026-08-01T00:00:00.000Z",
  };
  assert.equal(
    createSnapshotEnvelope(args).snapshotId,
    createSnapshotEnvelope(args).snapshotId,
  );
});
