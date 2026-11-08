import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalReceiptHash,
  evaluateLocalCiEvidence,
} from "../../scripts/lib/local-ci-evidence.mjs";
import { evaluateRequiredChecksSnapshot } from "../../scripts/lib/snapshot-evaluators.mjs";
import { combineShipGateResults } from "../../scripts/lib/ship-gate-policy.mjs";

const REPO = "Wibias/streamer-content";
const PR = 873;
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const NOW = Date.parse("2026-11-08T10:00:00.000Z");

function localConfig() {
  return {
    schemaVersion: 2,
    authorityMode: "high-assurance",
    ciEvidence: {
      defaultMode: "remote",
      repositories: {
        "wibias/streamer-content": {
          mode: "local",
          waiver: "t851s5532",
          recordedAt: "2026-11-08T09:31:00.000Z",
        },
      },
    },
  };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "gd-local-ci-"));
  const logPath = join(dir, "ci.log");
  writeFileSync(logPath, "all suites green\n", "utf8");
  return { dir, logPath, receiptPath: join(dir, "receipt.json") };
}

function receiptBody({ logPath }) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/local-ci-evidence",
    repository: REPO,
    pullRequest: PR,
    headSha: HEAD,
    baseSha: BASE,
    headCommittedAt: "2026-11-08T09:00:00.000Z",
    recordedAt: "2026-11-08T09:45:00.000Z",
    startedAt: "2026-11-08T09:30:00.000Z",
    completedAt: "2026-11-08T09:45:00.000Z",
    waiver: "t851s5532",
    exitCode: 0,
    commands: [
      {
        command: "npm run ci:local -- --full",
        scope: "full local CI",
        exitCode: 0,
      },
    ],
    runner: { host: "runner-1", platform: "win32", release: "10.0", arch: "x64" },
    tools: {
      node: "v22.20.0",
      npm: "10.9.0",
      git: "git version 2.47.0",
    },
    log: {
      path: logPath,
      sha256: "",
      bytes: 18,
    },
  };
}

function writeReceipt(fixtureValue, overrides = {}) {
  const body = {
    ...receiptBody(fixtureValue),
    ...overrides,
  };
  body.log = {
    ...body.log,
    sha256: createHash("sha256").update(readFileSync(fixtureValue.logPath)).digest("hex"),
    bytes: statSync(fixtureValue.logPath).size,
  };
  const receipt = { ...body, receiptHash: canonicalReceiptHash(body) };
  writeFileSync(fixtureValue.receiptPath, JSON.stringify(receipt, null, 2));
  return receipt;
}

function evaluate(fixtureValue, overrides = {}) {
  return evaluateLocalCiEvidence({
    config: localConfig(),
    repo: REPO,
    pr: PR,
    headSha: HEAD,
    baseSha: BASE,
    receiptPath: fixtureValue.receiptPath,
    now: NOW,
    isBaseAncestor: () => true,
    ...overrides,
  });
}

test("valid same-head receipt passes and remote mode stays inactive", () => {
  const value = fixture();
  writeReceipt(value);
  const result = evaluate(value);
  assert.equal(result.mode, "local");
  assert.equal(result.active, true);
  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);

  const remote = evaluateLocalCiEvidence({
    config: {
      schemaVersion: 2,
      authorityMode: "high-assurance",
      ciEvidence: { defaultMode: "remote", repositories: {} },
    },
    repo: REPO,
    pr: PR,
    headSha: HEAD,
    baseSha: BASE,
    receiptPath: value.receiptPath,
    now: NOW,
  });
  assert.equal(remote.mode, "remote");
  assert.equal(remote.active, false);
  assert.equal(remote.valid, false);
});

test("missing or foreign receipt stays blocked", () => {
  const value = fixture();
  assert.ok(evaluate(value).reasons.includes("local_evidence_missing"));

  writeReceipt(value, { repository: "other/repo" });
  const foreign = evaluate(value);
  assert.equal(foreign.valid, false);
  assert.ok(foreign.reasons.includes("local_evidence_foreign_repository"));
});

test("head, PR, waiver, red exit code, and tampered receipt fail closed", () => {
  const value = fixture();
  writeReceipt(value, { headSha: "c".repeat(40) });
  assert.ok(evaluate(value).reasons.includes("local_evidence_head_mismatch"));

  writeReceipt(value, { pullRequest: 1 });
  assert.ok(evaluate(value).reasons.includes("local_evidence_pull_request_mismatch"));

  writeReceipt(value, { waiver: "other" });
  assert.ok(evaluate(value).reasons.includes("local_evidence_waiver_mismatch"));

  writeReceipt(value, {
    exitCode: 1,
    commands: [{ command: "npm test", scope: "unit", exitCode: 1 }],
  });
  const red = evaluate(value);
  assert.ok(red.reasons.includes("local_evidence_exit_code_failed"));
  assert.ok(red.reasons.includes("local_evidence_command_failed"));

  const tampered = writeReceipt(value);
  tampered.runner.host = "other-host";
  writeFileSync(value.receiptPath, JSON.stringify(tampered, null, 2));
  assert.ok(evaluate(value).reasons.includes("local_evidence_receipt_tampered"));
});

test("stale and pre-head receipts stay blocked", () => {
  const value = fixture();
  writeReceipt(value, { completedAt: "2026-10-01T09:45:00.000Z" });
  assert.ok(evaluate(value).reasons.includes("local_evidence_stale"));

  writeReceipt(value, { completedAt: "2026-11-08T08:30:00.000Z" });
  assert.ok(
    evaluate(value, { headCommittedAt: "2026-11-08T09:00:00.000Z" }).reasons.includes(
      "local_evidence_predates_head",
    ),
  );
});

test("base divergence and unreadable ancestry fail closed", () => {
  const value = fixture();
  writeReceipt(value);
  assert.ok(
    evaluate(value, { baseSha: "d".repeat(40), isBaseAncestor: () => false }).reasons.includes(
      "local_evidence_base_not_ancestor",
    ),
  );
  assert.ok(
    evaluate(value, { baseSha: "d".repeat(40), isBaseAncestor: () => null }).reasons.includes(
      "local_evidence_base_ancestry_unknown",
    ),
  );
});

test("log tampering and missing provenance fail closed", () => {
  const value = fixture();
  writeReceipt(value);
  writeFileSync(value.logPath, "tampered\n");
  assert.ok(evaluate(value).reasons.includes("local_evidence_log_hash_mismatch"));

  const noRunner = fixture();
  writeReceipt(noRunner, { runner: { host: "" } });
  assert.ok(evaluate(noRunner).reasons.includes("local_evidence_runner_missing"));
});

function snapshotWithFailingRemoteCheck() {
  const source = () => ({ required: true, readable: true, complete: true, error: null });
  return {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "snap-local",
    capturedAt: "2026-11-08T09:59:30.000Z",
    repo: REPO,
    pr: PR,
    headOid: HEAD,
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
      baseRef: source(),
    },
    evidence: {
      pullRequest: {
        number: PR,
        url: "https://github.com/Wibias/streamer-content/pull/873",
        baseRefName: "main",
        headRefOid: HEAD,
        mergeStateStatus: "BLOCKED",
        mergeable: "MERGEABLE",
        reviewDecision: "APPROVED",
        isDraft: false,
        reviewRequests: [],
        stack: null,
        commits: [
          {
            oid: HEAD,
            committedDate: "2026-11-08T09:00:00.000Z",
          },
        ],
      },
      changedFiles: [{ filename: "src/index.js" }],
      branchProtection: null,
      activeRules: [],
      checks: {
        authoritative: { sha: HEAD, complete: true, reason: "head_only" },
        checkRuns: [
          {
            id: 1,
            name: "Affected tests",
            status: "completed",
            conclusion: "failure",
            completed_at: "2026-11-08T09:10:00.000Z",
            app: { id: 15368, slug: "github-actions" },
          },
        ],
        statuses: [],
      },
      baseHealth: {
        baseRefName: "main",
        baseOid: BASE,
        checks: { checkRuns: [], statuses: [] },
      },
      feedback: {
        issueComments: [],
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
      },
      codeowners: { path: ".github/CODEOWNERS", text: "", errors: [] },
      policy: {
        branchProtectionRules: { pageInfo: { hasNextPage: false }, nodes: [] },
        latestOpinionatedReviews: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              author: { login: "reviewer" },
              state: "APPROVED",
              submittedAt: "2026-11-08T09:20:00.000Z",
              commit: { oid: HEAD },
            },
          ],
        },
        mergeQueue: { enabled: false, inQueue: false, entry: null },
      },
      workflowCoverage: {
        complete: true,
        scannedRef: "main",
        workflowFiles: 1,
        hasMergeGroupTrigger: false,
        hasPullRequestTrigger: true,
        warning: null,
      },
      viewer: { login: "Wibias" },
    },
  };
}

test("snapshot gate uses valid local evidence and keeps remote failure visible", () => {
  const value = fixture();
  writeReceipt(value);
  const snapshot = snapshotWithFailingRemoteCheck();
  const result = evaluateRequiredChecksSnapshot(snapshot, {
    localEvidence: evaluate(value, { baseSha: BASE }),
  });
  assert.equal(result.decision, "ready");
  assert.equal(result.evidenceMode, "local");
  assert.equal(result.localEvidence.valid, true);
  assert.equal(result.remoteObserved.decision, "blocked");
  assert.ok(result.remoteObserved.blockers.some((row) => row.includes("Affected tests")));

  const blocked = evaluateRequiredChecksSnapshot(snapshot, {
    localEvidence: evaluate(value, {
      baseSha: "d".repeat(40),
      isBaseAncestor: () => false,
    }),
  });
  assert.equal(blocked.decision, "blocked");
  assert.ok(blocked.blockers.includes("local_evidence_base_not_ancestor"));
});

test("ship gate treats waived base health as advisory, not as a blocker", () => {
  const snapshot = snapshotWithFailingRemoteCheck();
  const requiredChecks = {
    decision: "ready",
    ready: true,
    complete: true,
    blockers: [],
    unknowns: [],
    evidenceMode: "local",
    localEvidence: { valid: true, reasons: [] },
    remoteObserved: { decision: "blocked", blockers: ["fail:Affected tests"], unknowns: [] },
  };
  const output = combineShipGateResults({
    snapshot,
    mutationProfile: { mode: "maintainer" },
    requiredChecks,
    baseHealth: {
      decision: "blocked",
      complete: true,
      blockers: ["pr_only_failure:Affected tests"],
      unknowns: [],
      sharedFailures: [],
    },
    reviewPolicy: { decision: "ready", complete: true, blockers: [], unknowns: [] },
    reviewThreads: { decision: "ready", complete: true, blockers: [], unknowns: [] },
    wake: { decision: "ready", complete: true, blockers: [], unknowns: [] },
    codeowners: { complete: true },
  });
  assert.equal(output.decision, "ready");
  assert.equal(output.remoteChecksWaived, true);
  assert.ok(
    output.advisories.some((row) => row.code === "remote_checks_waived_by_local_evidence"),
  );
});
