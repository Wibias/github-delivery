import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { snapshotIntegritySha256 } from "../../scripts/lib/snapshot-schema.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function source(required = true) {
  return { required, readable: true, complete: true, error: null };
}

function writeSnapshot() {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-ship-gate-"));
  const path = join(directory, "snapshot.json");
  const snapshot = {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    capturedAt: "2026-08-01T00:00:00.000Z",
    repo: "Wibias/github-delivery",
    pr: 42,
    headOid: "head123",
    complete: true,
    incompleteReasons: [],
    sources: {
      pr: source(),
      changedFiles: source(),
      activeRules: source(),
      checkRuns: source(),
      statuses: source(),
      issueComments: source(),
      reviewComments: source(),
      reviews: source(),
      reviewThreads: source(),
      branchProtection: source(false),
      codeowners: source(false),
      codeownersErrors: source(false),
      policyGraphql: source(),
      workflowCoverage: source(),
      viewer: source(),
    },
    evidence: {
      pullRequest: {
        number: 42,
        url: "https://github.com/Wibias/github-delivery/pull/42",
        baseRefName: "main",
        headRefOid: "head123",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        isDraft: false,
        reviewRequests: [],
        commits: [],
      },
      changedFiles: [],
      branchProtection: null,
      activeRules: [],
      checks: { checkRuns: [], statuses: [] },
      feedback: {
        issueComments: [],
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
      },
      codeowners: { path: null, text: null, errors: [] },
      policy: {
        branchProtectionRules: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        latestOpinionatedReviews: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        mergeQueue: { enabled: false, inQueue: false, entry: null },
      },
      workflowCoverage: {
        complete: true,
        scannedRef: "main",
        workflowFiles: 1,
        hasPullRequestTrigger: true,
        hasMergeGroupTrigger: false,
        warning: null,
      },
      viewer: { login: "Wibias" },
    },
  };
  const integritySha256 = snapshotIntegritySha256(snapshot);
  snapshot.snapshotId = integritySha256;
  snapshot.integritySha256 = integritySha256;
  writeFileSync(path, JSON.stringify(snapshot), "utf8");
  return path;
}

function runShipGate(snapshotPath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts", "ship-gate.mjs"),
      "Wibias/github-delivery",
      "42",
      "--snapshot",
      snapshotPath,
      "--expected-head",
      "head123",
      "--max-age-seconds",
      "999999999",
      ...extraArgs,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    },
  );
}

test("ship-gate evaluates a sealed replay without treating it as authoritative ready", () => {
  const result = runShipGate(writeSnapshot());
  assert.equal(
    result.status,
    2,
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "unknown");
  assert.equal(output.replayDecision, "ready");
  assert.equal(output.authoritative, false);
  assert.equal(output.evidenceMode, "snapshot_replay");
  assert.ok(output.unknowns.includes("snapshot_replay_not_authoritative"));
  assert.match(output.snapshotId, /^[0-9a-f]{64}$/);
  assert.equal(output.mutationMode, "read-only");
  assert.equal(output.mutationProfile.actions.merge_pr.allowed, false);
  assert.equal(output.components.baseHealth.comparisonRequired, false);
  assert.deepEqual(Object.keys(output.components).sort(), [
    "baseHealth",
    "codeowners",
    "requiredChecks",
    "reviewPolicy",
    "reviewThreads",
    "wake",
  ]);
});

test("ship-gate rejects replay evidence that was modified after sealing", () => {
  const path = writeSnapshot();
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  snapshot.evidence.pullRequest.reviewDecision = "CHANGES_REQUESTED";
  writeFileSync(path, JSON.stringify(snapshot), "utf8");
  const result = runShipGate(path);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /snapshot_integrity_mismatch/);
  assert.equal(result.stdout, "");
});

test("ship-gate reports the selected mutation profile on a non-authoritative replay", () => {
  const result = runShipGate(writeSnapshot(), [
    "--mutation-mode",
    "maintainer",
  ]);
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mutationMode, "maintainer");
  assert.equal(output.mutationProfile.actions.push_code.allowed, true);
  assert.equal(
    output.mutationProfile.actions.merge_pr.requiresExplicitInstruction,
    true,
  );
  assert.equal(output.authoritative, false);
});

test("ship-gate rejects a self-selected read-only mode for the full-review workflow", () => {
  const result = runShipGate(writeSnapshot(), [
    "--mutation-mode",
    "read-only",
    "--workflow",
    "references/full-review-pr.md",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mode_denied_by_workflow/);
  assert.match(result.stderr, /allowed: review, maintainer/);
});

test("ship-gate accepts routed review mode but keeps replay non-authoritative", () => {
  const result = runShipGate(writeSnapshot(), [
    "--mutation-mode",
    "review",
    "--workflow",
    "references/full-review-pr.md",
  ]);
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mutationMode, "review");
  assert.equal(output.workflow, "references/full-review-pr.md");
  assert.equal(output.authoritative, false);
});

test("ship-gate fails closed on an unknown workflow", () => {
  const result = runShipGate(writeSnapshot(), [
    "--mutation-mode",
    "review",
    "--workflow",
    "references/unknown.md",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown_workflow/);
});
