import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { refreshExpectedHeads } from "../../scripts/lib/authority-head-refresh.mjs";
import { createDeliveryWorkflowController } from "../../scripts/lib/delivery-workflow-controller.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function readySnapshot({ headOid }) {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    repo: "acme/widget",
    pr: 42,
    headOid,
    baseOid: "cccccccccccccccccccccccccccccccccccccccc",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: { state: "SUCCESS" },
    evidence: {
      checks: { authoritative: true, sha: headOid, reason: "fixture" },
    },
  };
}

function runShipGate(args) {
  return spawnSync(process.execPath, [join(ROOT, "scripts/ship-gate.mjs"), ...args], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

test("live ship gate rejects a moved expected head", () => {
  const dir = mkdtempSync(join(tmpdir(), "gd-live-gate-"));
  const snapshotPath = join(dir, "ready.json");
  writeFileSync(snapshotPath, JSON.stringify(readySnapshot({ headOid: SHA_B })), "utf8");

  const result = runShipGate([
    "acme/widget",
    "42",
    "--expected-head",
    SHA_A,
    "--snapshot",
    snapshotPath,
  ]);

  assert.equal(result.status, 2);
  assert.match(String(result.stderr || result.stdout || ""), /expected_head_mismatch/);
});

test("authority acquisition never retargets a stale reviewed request", () => {
  const request = {
    action: "post_review",
    repo: "acme/widget",
    pr: 42,
    expectedHead: SHA_A,
    body: "review of SHA A",
  };

  assert.throws(
    () =>
      refreshExpectedHeads({
        requests: [request],
        runner: () =>
          JSON.stringify({
            headRefOid: SHA_B,
            headRefName: "feature",
          }),
      }),
    /expected_head_mismatch/,
  );
});

test("changing the PR target invalidates controller evidence generation", () => {
  const controller = createDeliveryWorkflowController({
    workflow: "status",
    repo: "o/r",
    pr: 1,
    headSha: "h",
    graph: { A: [] },
    startPhase: "A",
  });
  controller.recordEvidence({
    key: "pr-ship-gate:o/r:1",
    covers: ["checks"],
    authoritative: true,
  });

  const update = controller.updateRefs({ pr: 2 });
  assert.equal(update.changed, true);
  assert.ok(update.stateGeneration > 0);
  const decision = controller.decideEvidence({
    key: "pr-ship-gate:o/r:1",
    requires: ["checks"],
  });
  assert.equal(decision.action, "allow");
  assert.notEqual(decision.reason, "evidence_already_covered");
});
