import assert from "node:assert/strict";
import test from "node:test";
import { enrichSnapshotWithBaseHealth } from "../../scripts/lib/base-health-live.mjs";

const original = {
  repo: "Wibias/shipping-github",
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
