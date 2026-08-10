import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readValidatedSnapshot,
  validateSnapshot,
} from "../../scripts/lib/snapshot-input.mjs";
import {
  evaluateCodeownersSnapshot,
  evaluateRequiredChecksSnapshot,
  evaluateReviewPolicySnapshot,
  evaluateReviewThreadsSnapshot,
  evaluateWakeSnapshot,
} from "../../scripts/lib/snapshot-evaluators.mjs";

const NOW = Date.parse("2026-08-01T00:00:00.000Z");

function source(required = true) {
  return { required, readable: true, complete: true, error: null };
}

function snapshot(overrides = {}) {
  const value = {
    schemaVersion: 1,
    kind: "github-delivery/evidence-snapshot",
    snapshotId: "snap-1",
    capturedAt: "2026-07-31T23:59:30.000Z",
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
        commits: [
          {
            oid: "head123",
            messageHeadline: "fix: address review",
            committedDate: "2026-07-31T23:59:00.000Z",
          },
        ],
      },
      changedFiles: [{ filename: "src/index.mjs" }],
      branchProtection: null,
      activeRules: [],
      checks: {
        checkRuns: [
          {
            id: 1,
            name: "CI",
            status: "completed",
            conclusion: "success",
            completed_at: "2026-07-31T23:59:00.000Z",
            app: { id: 7, slug: "actions" },
          },
        ],
        statuses: [],
      },
      feedback: {
        issueComments: [],
        reviewComments: [],
        reviews: [],
        reviewThreads: [],
      },
      codeowners: {
        path: ".github/CODEOWNERS",
        text: "src/** @maintainers\n",
        errors: [],
      },
      policy: {
        branchProtectionRules: {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        latestOpinionatedReviews: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              author: { login: "reviewer" },
              state: "APPROVED",
              submittedAt: "2026-07-31T23:58:00.000Z",
              commit: { oid: "head123" },
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
  return structuredClone(Object.assign(value, overrides));
}

test("validates snapshot identity, age, and head consistency", () => {
  const result = validateSnapshot({
    snapshot: snapshot(),
    repo: "Wibias/github-delivery",
    pr: 42,
    expectedHead: "head123",
    maxAgeSeconds: 60,
    now: NOW,
  });
  assert.deepEqual(result, { valid: true, reasons: [] });
});

test("rejects mismatched, stale, incomplete, and internally inconsistent snapshots", () => {
  const wrongRepo = validateSnapshot({
    snapshot: snapshot(),
    repo: "other/repo",
    pr: 42,
    now: NOW,
  });
  assert.ok(wrongRepo.reasons.includes("repo_mismatch"));

  const stale = validateSnapshot({
    snapshot: snapshot({ capturedAt: "2026-07-31T23:00:00.000Z" }),
    repo: "Wibias/github-delivery",
    pr: 42,
    maxAgeSeconds: 60,
    now: NOW,
  });
  assert.ok(stale.reasons.includes("snapshot_stale"));

  const incompleteValue = snapshot({ complete: false });
  incompleteValue.sources.checkRuns.complete = false;
  const incomplete = validateSnapshot({
    snapshot: incompleteValue,
    repo: "Wibias/github-delivery",
    pr: 42,
    now: NOW,
  });
  assert.ok(incomplete.reasons.includes("snapshot_incomplete"));

  const inconsistentValue = snapshot();
  inconsistentValue.evidence.pullRequest.headRefOid = "different";
  const inconsistent = validateSnapshot({
    snapshot: inconsistentValue,
    repo: "Wibias/github-delivery",
    pr: 42,
    now: NOW,
  });
  assert.ok(inconsistent.reasons.includes("head_evidence_mismatch"));
});

test("reads and validates a snapshot file", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-snapshot-"));
  const path = join(directory, "snapshot.json");
  writeFileSync(path, JSON.stringify(snapshot()), "utf8");
  const result = readValidatedSnapshot({
    path,
    repo: "Wibias/github-delivery",
    pr: 42,
    maxAgeSeconds: 60,
    now: NOW,
  });
  assert.equal(result.snapshotId, "snap-1");
});

test("evaluates required checks from snapshot evidence", () => {
  const value = snapshot();
  value.evidence.activeRules = [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [{ context: "CI", integration_id: 7 }],
      },
    },
  ];
  const result = evaluateRequiredChecksSnapshot(value);
  assert.equal(result.decision, "ready");
  assert.equal(result.requiredStatus[0].context, "CI");
  assert.equal(result.requiredStatus[0].appId, 7);
});

test("evaluates review policy and unresolved threads independently", () => {
  const value = snapshot();
  value.evidence.activeRules = [
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        required_review_thread_resolution: true,
      },
    },
  ];
  value.evidence.feedback.reviewThreads = [
    {
      id: "PRRT_1",
      isResolved: false,
      isOutdated: false,
      path: "src/index.mjs",
      line: 3,
      comments: { nodes: [] },
    },
  ];

  const policy = evaluateReviewPolicySnapshot(value);
  assert.equal(policy.decision, "ready");
  assert.equal(policy.reviewPolicy.requiresConversationResolution, true);

  const threads = evaluateReviewThreadsSnapshot(value);
  assert.equal(threads.decision, "blocked");
  assert.equal(threads.unresolvedCount, 1);
});

test("evaluates advisory CODEOWNERS matches from the same changed-file evidence", () => {
  const result = evaluateCodeownersSnapshot(snapshot());
  assert.equal(result.authority, "advisory");
  assert.deepEqual(result.ownersUnion, ["@maintainers"]);
  assert.deepEqual(result.files["src/index.mjs"], {
    pattern: "src/**",
    owners: ["@maintainers"],
  });
});

test("evaluates wake state using snapshot feedback and viewer identity", () => {
  const value = snapshot();
  value.evidence.feedback.issueComments = [
    {
      id: 99,
      html_url: "https://example.test/comment/99",
      user: { login: "maintainer" },
      author_association: "MEMBER",
      repository_permission: "write",
      created_at: "2026-07-31T23:59:20.000Z",
      body: "Please add a regression test.",
    },
  ];
  const result = evaluateWakeSnapshot(value);
  assert.equal(result.decision, "blocked");
  assert.equal(result.blockers[0].key, "issue_comment:99");
});
