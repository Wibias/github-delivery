import assert from "node:assert/strict";
import test from "node:test";
import { enrichSnapshotWithBaseHealth } from "../../scripts/lib/base-health-live.mjs";
import { snapshotIntegritySha256 } from "../../scripts/lib/snapshot-schema.mjs";

const original = {
  repo: "Wibias/github-delivery",
  sources: {},
  evidence: { pullRequest: { baseRefName: "main" } },
};

test("captures base SHA, checks, and statuses into one snapshot", () => {
  const calls = [];
  const result = enrichSnapshotWithBaseHealth(original, {
    runGh(args) {
      calls.push(args.join(" "));
      const path = args[1];
      if (path.includes("commits/main")) {
        return { ok: true, body: JSON.stringify({ sha: "base123" }) };
      }
      if (path.includes("check-runs")) {
        return {
          ok: true,
          body: JSON.stringify({
            total_count: 1,
            check_runs: [{ name: "CI" }],
          }),
        };
      }
      return {
        ok: true,
        body: JSON.stringify([{ context: "legacy", state: "success" }]),
      };
    },
  });
  assert.equal(result.evidence.baseHealth.baseOid, "base123");
  assert.equal(result.evidence.baseHealth.checks.checkRuns.length, 1);
  assert.equal(result.evidence.baseHealth.checks.statuses.length, 1);
  assert.equal(result.sources.baseCheckRuns.complete, true);
  assert.ok(calls.some((call) => call.includes("commits/base123/check-runs")));
  assert.equal(result.snapshotId, result.integritySha256);
  assert.equal(result.integritySha256, snapshotIntegritySha256(result));
});

test("records incomplete optional evidence when base ref cannot be read", () => {
  const result = enrichSnapshotWithBaseHealth(original, {
    runGh() {
      return { ok: false, body: "", error: "denied" };
    },
  });
  assert.equal(result.sources.baseRef.complete, false);
  assert.equal(result.sources.baseCheckRuns.complete, false);
  assert.equal(result.evidence.baseHealth.baseOid, null);
});

test("rejects base-health evidence from a base tip outside the capture boundary", () => {
  const sealed = {
    ...original,
    evidence: {
      ...original.evidence,
      captureBoundary: { baseOid: "base-old" },
    },
  };
  assert.throws(
    () =>
      enrichSnapshotWithBaseHealth(sealed, {
        runGh(args) {
          const path = args[1];
          if (path.includes("commits/main")) {
            return { ok: true, body: JSON.stringify({ sha: "base-new" }) };
          }
          throw new Error(`unexpected call: ${args.join(" ")}`);
        },
      }),
    /base_health_boundary_mismatch/,
  );
});
