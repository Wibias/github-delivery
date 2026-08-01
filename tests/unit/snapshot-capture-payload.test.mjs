import assert from "node:assert/strict";
import test from "node:test";

import { assembleSnapshotCapture } from "../../scripts/lib/snapshot-capture-payload.mjs";

function collection(rows = []) {
  return { readable: true, complete: true, pages: 1, rows, error: null };
}

test("assembles all evidence required by snapshot-backed gates", () => {
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
      warning: null,
      error: null,
    },
    viewer: {
      readable: true,
      complete: true,
      login: "Wibias",
      error: null,
    },
  });

  assert.equal(result.sources.policyGraphql.required, true);
  assert.equal(result.sources.workflowCoverage.complete, true);
  assert.equal(result.sources.viewer.complete, true);
  assert.equal(result.evidence.policy.mergeQueue.enabled, false);
  assert.equal(result.evidence.workflowCoverage.workflowFiles, 1);
  assert.equal(result.evidence.viewer.login, "Wibias");
  assert.deepEqual(result.evidence.codeowners.errors, []);
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
