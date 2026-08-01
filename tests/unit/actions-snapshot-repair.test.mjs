import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  actionsPolicyQuery,
  actionsSnapshotRepairPlan,
  repairActionsSnapshot,
} from "../../scripts/lib/actions-snapshot-repair.mjs";
import { createSnapshotEnvelope } from "../../scripts/lib/snapshot-schema.mjs";

function source(required = true) {
  return { required, readable: true, complete: true, error: null };
}

function restricted() {
  return {
    required: true,
    readable: false,
    complete: false,
    error: "gh: Resource not accessible by integration (HTTP 403)",
  };
}

function snapshot(overrides = {}) {
  const sources = {
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
    policyGraphql: restricted(),
    workflowCoverage: source(),
    viewer: restricted(),
    ...overrides.sources,
  };
  return createSnapshotEnvelope({
    repo: "Wibias/shipping-github",
    pr: 35,
    headOid: "head123",
    capturedAt: "2026-08-01T06:01:58.208Z",
    sources,
    evidence: {
      pullRequest: {
        number: 35,
        baseRefName: "main",
        headRefOid: "head123",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        reviewDecision: "",
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
          pageInfo: { hasNextPage: true },
          nodes: [],
        },
        latestOpinionatedReviews: {
          pageInfo: { hasNextPage: true },
          nodes: [],
        },
        mergeQueue: { enabled: false, inQueue: false, entry: null },
      },
      workflowCoverage: {
        complete: true,
        scannedRef: "main",
        workflowFiles: 6,
        hasPullRequestTrigger: true,
        hasMergeGroupTrigger: false,
        warning: null,
      },
      viewer: { login: null },
      ...overrides.evidence,
    },
  });
}

function policy() {
  return {
    latestOpinionatedReviews: {
      pageInfo: { hasNextPage: false },
      nodes: [],
    },
    mergeQueue: { enabled: false, inQueue: false, entry: null },
  };
}

test("Actions policy query excludes repository-admin branch rules", () => {
  const query = actionsPolicyQuery();
  assert.doesNotMatch(query, /branchProtectionRules/);
  assert.match(query, /latestOpinionatedReviews/);
  assert.match(query, /isInMergeQueue/);
});

test("plans repair only for exact Actions installation restrictions", () => {
  const plan = actionsSnapshotRepairPlan(snapshot(), {
    GITHUB_ACTIONS: "true",
    GITHUB_ACTOR: "Wibias",
  });
  assert.equal(plan.repairable, true);
  assert.equal(plan.repairPolicy, true);
  assert.equal(plan.repairViewer, true);
  assert.equal(plan.actor, "Wibias");

  const outsideActions = actionsSnapshotRepairPlan(snapshot(), {
    GITHUB_ACTIONS: "false",
    GITHUB_ACTOR: "Wibias",
  });
  assert.equal(outsideActions.repairable, false);
});

test("refuses an invalid Actions actor fallback", () => {
  const plan = actionsSnapshotRepairPlan(snapshot(), {
    GITHUB_ACTIONS: "true",
    GITHUB_ACTOR: "not a login!",
  });
  assert.equal(plan.repairable, false);
  assert.equal(plan.actor, null);
});

test("repairs policy and viewer evidence when no classic protection exists", () => {
  const repaired = repairActionsSnapshot({
    snapshot: snapshot(),
    policy: policy(),
    branchProtection: null,
    actor: "Wibias",
  });
  assert.equal(repaired.complete, true);
  assert.equal(repaired.sources.policyGraphql.complete, true);
  assert.equal(repaired.sources.viewer.complete, true);
  assert.equal(repaired.sources.branchProtection.required, false);
  assert.equal(repaired.evidence.viewer.login, "Wibias");
  assert.deepEqual(
    repaired.evidence.policy.branchProtectionRules.nodes,
    [],
  );
});

test("preserves classic branch protection as required evidence", () => {
  const protection = {
    required_status_checks: { strict: true, contexts: ["CI"] },
  };
  const repaired = repairActionsSnapshot({
    snapshot: snapshot(),
    policy: policy(),
    branchProtection: protection,
    actor: "github-actions[bot]",
  });
  assert.equal(repaired.complete, true);
  assert.equal(repaired.sources.branchProtection.required, true);
  assert.deepEqual(repaired.evidence.branchProtection, protection);
  assert.deepEqual(
    repaired.evidence.policy.branchProtectionRules.nodes,
    [{ pattern: "main" }],
  );
});

test("does not hide unrelated incomplete evidence", () => {
  const initial = snapshot({
    sources: {
      changedFiles: {
        required: true,
        readable: false,
        complete: false,
        error: "pagination failed",
      },
    },
  });
  const repaired = repairActionsSnapshot({
    snapshot: initial,
    policy: policy(),
    branchProtection: null,
    actor: "Wibias",
  });
  assert.equal(repaired.complete, false);
  assert.ok(
    repaired.incompleteReasons.some(
      (reason) => reason.source === "changedFiles",
    ),
  );
});

test("live fixture invokes the Actions-aware snapshot adapter", () => {
  const source = readFileSync(
    new URL("../../scripts/live-github-fixture.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /scripts\/actions-ship-gate-snapshot\.mjs/);
  assert.doesNotMatch(
    source,
    /run\(process\.execPath, \["scripts\/ship-gate-snapshot\.mjs"/,
  );
});
