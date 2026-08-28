import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRequiredCheckWorkflowMapping,
  workflowHasTopLevelEvent,
  workflowRunIdFromCheckRun,
} from "../../scripts/lib/merge-group-workflow-coverage.mjs";
import {
  assertFreshCheckGeneration,
  captureCurrentCheckGeneration,
  checkGenerationFingerprint,
} from "../../scripts/lib/live-snapshot.mjs";
import {
  assembleSnapshotCapture,
  classifyBranchProtectionResponse,
  snapshotBoundaryFingerprint,
  verifySnapshotBoundary,
} from "../../scripts/lib/snapshot-capture-payload.mjs";

function collection(rows = []) {
  return { readable: true, complete: true, pages: 1, rows, error: null };
}

test("assembles all evidence required by snapshot-backed gates", () => {
  const boundary = {
    headOid: "abc",
    baseRefName: "main",
    baseOid: "base123",
    rulesFingerprint: snapshotBoundaryFingerprint([]),
  };
  const result = assembleSnapshotCapture({
    prEvidence: {
      number: 7,
      baseRefName: "main",
      headRefOid: "abc",
      reviewDecision: "APPROVED",
    },
    changedFiles: collection([{ filename: "src/a.mjs" }]),
    activeRules: collection([]),
    checkRuns: collection([]),
    statuses: collection([]),
    issueComments: collection([]),
    reviewComments: collection([]),
    reviews: collection([]),
    threads: collection([]),
    branchProtection: {
      required: false,
      readable: true,
      complete: true,
      payload: null,
      error: null,
    },
    codeowners: {
      readable: true,
      complete: true,
      path: ".github/CODEOWNERS",
      text: "src/** @team\n",
      errors: [],
      errorsReadable: true,
      errorsComplete: true,
      error: null,
    },
    policy: {
      readable: true,
      complete: true,
      branchProtectionRules: {
        pageInfo: { hasNextPage: false },
        nodes: [],
      },
      latestOpinionatedReviews: {
        pageInfo: { hasNextPage: false },
        nodes: [],
      },
      mergeQueue: { enabled: false, inQueue: false, entry: null },
      error: null,
    },
    workflowCoverage: {
      readable: true,
      complete: true,
      scannedRef: "main",
      workflowFiles: 1,
      hasPullRequestTrigger: true,
      hasMergeGroupTrigger: false,
      requiredCheckWorkflowMappingComplete: true,
      requiredGithubActionsCheckCount: 0,
      mappings: [],
      unmapped: [],
      warning: null,
      error: null,
    },
    viewer: {
      readable: true,
      complete: true,
      login: "Wibias",
      error: null,
    },
    boundary,
  });

  assert.equal(result.sources.policyGraphql.required, true);
  assert.equal(result.sources.workflowCoverage.complete, true);
  assert.equal(result.sources.viewer.complete, true);
  assert.equal(result.evidence.policy.mergeQueue.enabled, false);
  assert.equal(result.evidence.workflowCoverage.workflowFiles, 1);
  assert.equal(result.evidence.workflowCoverage.requiredCheckWorkflowMappingComplete, true);
  assert.equal(result.evidence.viewer.login, "Wibias");
  assert.deepEqual(result.evidence.codeowners.errors, []);
  assert.deepEqual(result.evidence.captureBoundary, boundary);
});

test("marks a required policy source incomplete instead of manufacturing a complete snapshot", () => {
  const result = assembleSnapshotCapture({
    prEvidence: { number: 7, baseRefName: "main", headRefOid: "abc" },
    changedFiles: collection(),
    activeRules: collection(),
    checkRuns: collection(),
    statuses: collection(),
    issueComments: collection(),
    reviewComments: collection(),
    reviews: collection(),
    threads: collection(),
    branchProtection: {
      required: false,
      readable: true,
      complete: true,
      payload: null,
      error: null,
    },
    codeowners: {
      readable: true,
      complete: true,
      path: null,
      text: null,
      errors: [],
      errorsReadable: true,
      errorsComplete: true,
      error: null,
    },
    policy: {
      readable: false,
      complete: false,
      branchProtectionRules: { pageInfo: { hasNextPage: true }, nodes: [] },
      latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [] },
      mergeQueue: null,
      error: "GraphQL unavailable",
    },
    workflowCoverage: {
      readable: true,
      complete: true,
      workflowFiles: 0,
      error: null,
    },
    viewer: { readable: true, complete: true, login: "Wibias", error: null },
  });

  assert.equal(result.sources.policyGraphql.complete, false);
  assert.equal(result.sources.policyGraphql.error, "GraphQL unavailable");
});

test("snapshot boundary rejects a PR head that moved during capture", () => {
  assert.throws(
    () =>
      verifySnapshotBoundary(
        { headRefOid: "head-a", baseRefName: "main" },
        { headRefOid: "head-b", baseRefName: "main" },
      ),
    /snapshot_head_moved/,
  );
});

test("snapshot boundary rejects a base retarget during capture", () => {
  assert.throws(
    () =>
      verifySnapshotBoundary(
        { headRefOid: "head-a", baseRefName: "main" },
        { headRefOid: "head-a", baseRefName: "release" },
      ),
    /snapshot_base_moved/,
  );
});

test("snapshot boundary rejects a base commit that moved during capture", () => {
  assert.throws(
    () =>
      verifySnapshotBoundary(
        { headRefOid: "head-a", baseRefName: "main" },
        { headRefOid: "head-a", baseRefName: "main" },
        {
          initialBaseOid: "base-a",
          finalBaseOid: "base-b",
          initialRules: collection(),
          finalRules: collection(),
        },
      ),
    /snapshot_base_oid_moved/,
  );
});

test("snapshot boundary preserves the cause of incomplete rules evidence", () => {
  let observed = null;
  try {
    verifySnapshotBoundary(
      { headRefOid: "head-a", baseRefName: "main" },
      { headRefOid: "head-a", baseRefName: "main" },
      {
        initialBaseOid: "base-a",
        finalBaseOid: "base-a",
        initialRules: {
          readable: false,
          complete: false,
          pages: 0,
          rows: [],
          error: "HTTP 403: Upgrade to GitHub Pro to use repository rules",
        },
        finalRules: {
          readable: false,
          complete: false,
          pages: 0,
          rows: [],
          error: "HTTP 403: Upgrade to GitHub Pro to use repository rules",
        },
      },
    );
  } catch (error) {
    observed = error;
  }

  assert.ok(observed instanceof Error);
  assert.equal(observed.code, "snapshot_rules_boundary_incomplete");
  assert.equal(
    observed.causeMessage,
    "HTTP 403: Upgrade to GitHub Pro to use repository rules",
  );
});

test("snapshot boundary rejects effective rules that changed during capture", () => {
  assert.throws(
    () =>
      verifySnapshotBoundary(
        { headRefOid: "head-a", baseRefName: "main" },
        { headRefOid: "head-a", baseRefName: "main" },
        {
          initialBaseOid: "base-a",
          finalBaseOid: "base-a",
          initialRules: collection([{ type: "pull_request" }]),
          finalRules: collection([
            { type: "pull_request" },
            { type: "required_status_checks" },
          ]),
        },
      ),
    /snapshot_rules_moved/,
  );
});

test("snapshot boundary rejects mutable PR policy state that changed", () => {
  assert.throws(
    () =>
      verifySnapshotBoundary(
        {
          headRefOid: "head-a",
          baseRefName: "main",
          reviewDecision: "APPROVED",
          updatedAt: "2026-08-09T00:00:00Z",
        },
        {
          headRefOid: "head-a",
          baseRefName: "main",
          reviewDecision: "CHANGES_REQUESTED",
          updatedAt: "2026-08-09T00:00:01Z",
        },
      ),
    /snapshot_pr_state_moved/,
  );
});

test("snapshot boundary accepts one unchanged state generation", () => {
  const rules = collection([{ type: "pull_request", parameters: { required: true } }]);
  assert.deepEqual(
    verifySnapshotBoundary(
      {
        headRefOid: "head-a",
        baseRefName: "main",
        reviewDecision: "APPROVED",
        updatedAt: "2026-08-09T00:00:00Z",
      },
      {
        headRefOid: "head-a",
        baseRefName: "main",
        reviewDecision: "APPROVED",
        updatedAt: "2026-08-09T00:00:00Z",
      },
      {
        initialBaseOid: "base-a",
        finalBaseOid: "base-a",
        initialRules: rules,
        finalRules: collection([{ parameters: { required: true }, type: "pull_request" }]),
      },
    ),
    {
      headOid: "head-a",
      baseRefName: "main",
      baseOid: "base-a",
      rulesFingerprint: snapshotBoundaryFingerprint(rules.rows),
    },
  );
});

test("branch protection response treats only explicit 404 as unprotected", () => {
  const notFound = classifyBranchProtectionResponse({
    ok: false,
    body: "",
    error: "HTTP 404: Not Found",
  });
  assert.equal(notFound.required, false);
  assert.equal(notFound.readable, true);
  assert.equal(notFound.complete, true);

  const forbidden = classifyBranchProtectionResponse({
    ok: false,
    body: "",
    error: "HTTP 403: Resource not accessible by integration",
  });
  assert.equal(forbidden.required, true);
  assert.equal(forbidden.readable, false);
  assert.equal(forbidden.complete, false);
});

test("branch protection response parses an authoritative protected branch payload", () => {
  const result = classifyBranchProtectionResponse({
    ok: true,
    body: JSON.stringify({ required_status_checks: { strict: true } }),
    error: null,
  });
  assert.equal(result.required, true);
  assert.equal(result.readable, true);
  assert.equal(result.complete, true);
  assert.equal(result.payload.required_status_checks.strict, true);
});

test("extracts GitHub Actions workflow run IDs from required check details URLs", () => {
  assert.equal(
    workflowRunIdFromCheckRun({
      details_url: "https://github.com/acme/widgets/actions/runs/123456789/job/987",
    }),
    123456789,
  );
});

test("exact required GitHub Actions check mapping is complete only when every producer workflow handles merge_group", () => {
  const result = evaluateRequiredCheckWorkflowMapping({
    descriptors: [
      { context: "build", appId: 15368 },
      { context: "lint", appId: 15368 },
    ],
    checkRuns: [
      {
        name: "build",
        app: { id: 15368 },
        details_url: "https://github.com/acme/widgets/actions/runs/100/job/1",
      },
      {
        name: "lint",
        app: { id: 15368 },
        details_url: "https://github.com/acme/widgets/actions/runs/200/job/2",
      },
    ],
    workflowRunPaths: {
      100: ".github/workflows/ci.yml",
      200: ".github/workflows/lint.yml",
    },
    workflowTexts: {
      ".github/workflows/ci.yml": "on:\n  pull_request:\n  merge_group:\n",
      ".github/workflows/lint.yml": "on:\n  pull_request:\n  merge_group:\n",
    },
  });
  assert.equal(result.requiredCheckWorkflowMappingComplete, true);
  assert.equal(result.mappings.length, 2);
  assert.deepEqual(result.unmapped, []);
});

test("required GitHub Actions mapping fails closed when one producer lacks merge_group", () => {
  const result = evaluateRequiredCheckWorkflowMapping({
    descriptors: [{ context: "build", appId: 15368 }],
    checkRuns: [
      {
        name: "build",
        app: { id: 15368 },
        details_url: "https://github.com/acme/widgets/actions/runs/100/job/1",
      },
    ],
    workflowRunPaths: { 100: ".github/workflows/ci.yml" },
    workflowTexts: {
      ".github/workflows/ci.yml": "on:\n  pull_request:\n",
    },
  });
  assert.equal(result.requiredCheckWorkflowMappingComplete, false);
  assert.deepEqual(result.unmapped, [
    {
      context: "build",
      appId: 15368,
      reason: "workflow_missing_merge_group",
      path: ".github/workflows/ci.yml",
    },
  ]);
});

test("merge-group workflow trigger parser requires a real top-level event key", () => {
  assert.equal(
    workflowHasTopLevelEvent(
      "on:\n  pull_request:\n    branches: [main]\n  merge_group:\n    types: [checks_requested]\n",
      "merge_group",
    ),
    true,
  );
  assert.equal(
    workflowHasTopLevelEvent(
      "name: CI\non:\n  pull_request:\n\njobs:\n  build:\n    steps:\n      - run: echo merge_group\n",
      "merge_group",
    ),
    false,
  );
});

test("snapshot check generation fingerprint is stable across ordering and volatile fields", () => {
  const left = checkGenerationFingerprint({
    checkRuns: [
      {
        id: 2,
        name: "lint",
        head_sha: "abc",
        status: "completed",
        conclusion: "success",
        app: { id: 10, slug: "github-actions" },
        output: { title: "ignored" },
      },
      {
        id: 1,
        name: "build",
        head_sha: "abc",
        status: "completed",
        conclusion: "success",
        app: { id: 10 },
      },
    ],
    statuses: [
      {
        id: 7,
        sha: "abc",
        context: "legacy",
        state: "success",
        creator: { id: 9, login: "bot" },
      },
    ],
  });
  const right = checkGenerationFingerprint({
    checkRuns: [
      {
        id: 1,
        name: "build",
        head_sha: "abc",
        status: "completed",
        conclusion: "success",
        app: { id: 10, extra: "ignored" },
      },
      {
        id: 2,
        name: "lint",
        head_sha: "abc",
        status: "completed",
        conclusion: "success",
        app: { id: 10 },
      },
    ],
    statuses: [
      {
        id: 7,
        sha: "abc",
        context: "legacy",
        state: "success",
        creator: { id: 9, login: "bot", avatar_url: "ignored" },
      },
    ],
  });
  assert.equal(left, right);
});

test("live check generation rejects stale snapshot checks", () => {
  assert.throws(
    () =>
      assertFreshCheckGeneration(
        {
          headOid: "abc",
          evidence: {
            checks: {
              authoritative: { sha: "abc" },
              checkRuns: [{ id: 1, name: "build", head_sha: "abc", status: "queued" }],
              statuses: [],
            },
          },
        },
        {
          sha: "abc",
          checkRuns: [{ id: 1, name: "build", head_sha: "abc", status: "completed" }],
          statuses: [],
          fingerprint: checkGenerationFingerprint({
            checkRuns: [{ id: 1, name: "build", head_sha: "abc", status: "completed" }],
            statuses: [],
          }),
        },
      ),
    /live_snapshot_check_generation_moved/,
  );
});

test("captures one complete live check generation with pagination", () => {
  const calls = [];
  const runner = (_command, args) => {
    calls.push(args.join(" "));
    if (args[1].includes("check-runs")) {
      return {
        status: 0,
        stdout: JSON.stringify([
          { total_count: 2, check_runs: [{ id: 1 }] },
          { total_count: 2, check_runs: [{ id: 2 }] },
        ]),
        stderr: "",
      };
    }
    return {
      status: 0,
      stdout: JSON.stringify([[{ id: 3 }], [{ id: 4 }]]),
      stderr: "",
    };
  };
  const result = captureCurrentCheckGeneration({
    repo: "acme/widgets",
    sha: "ABC",
    runner,
  });
  assert.equal(result.sha, "abc");
  assert.deepEqual(result.checkRuns.map((row) => row.id), [1, 2]);
  assert.deepEqual(result.statuses.map((row) => row.id), [3, 4]);
  assert.equal(calls.length, 2);
});
