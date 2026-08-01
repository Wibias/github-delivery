import { createSnapshotEnvelope } from "./snapshot-schema.mjs";

const INTEGRATION_ACCESS_ERROR = /Resource not accessible by integration/i;
const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?$/;

function sourceRestricted(snapshot, name) {
  const source = snapshot?.sources?.[name];
  return (
    source?.required === true &&
    source?.complete !== true &&
    INTEGRATION_ACCESS_ERROR.test(String(source?.error || ""))
  );
}

export function actionsPolicyQuery() {
  return `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          isInMergeQueue
          isMergeQueueEnabled
          mergeQueueEntry {
            position
            state
            enqueuedAt
            estimatedTimeToMerge
          }
          latestOpinionatedReviews(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              author { login }
              state
              submittedAt
              commit { oid }
            }
          }
        }
      }
    }`;
}

export function actionsSnapshotRepairPlan(snapshot, env = process.env) {
  const actor = String(env.GITHUB_ACTOR || "").trim();
  const inActions = env.GITHUB_ACTIONS === "true";
  const repairPolicy = sourceRestricted(snapshot, "policyGraphql");
  const repairViewer = sourceRestricted(snapshot, "viewer");
  const actorValid = SAFE_ACTOR.test(actor);

  return {
    inActions,
    repairPolicy,
    repairViewer,
    actor: actorValid ? actor : null,
    repairable:
      inActions &&
      (repairPolicy || repairViewer) &&
      (!repairViewer || actorValid),
  };
}

export function repairActionsSnapshot({
  snapshot,
  policy = null,
  branchProtection = undefined,
  actor = null,
} = {}) {
  if (!snapshot || snapshot.kind !== "shipping-github/evidence-snapshot") {
    throw new Error("snapshot must be a shipping-github evidence snapshot");
  }

  const sources = structuredClone(snapshot.sources || {});
  const evidence = structuredClone(snapshot.evidence || {});
  const base = evidence.pullRequest?.baseRefName;

  if (policy) {
    if (!base) throw new Error("snapshot pull request base branch is missing");
    if (branchProtection === undefined) {
      throw new Error("branchProtection must be provided when repairing policy evidence");
    }
    const latestOpinionatedReviews = policy.latestOpinionatedReviews;
    if (
      !latestOpinionatedReviews ||
      latestOpinionatedReviews.pageInfo?.hasNextPage === true
    ) {
      throw new Error("Actions policy review evidence is incomplete");
    }
    sources.policyGraphql = {
      required: true,
      readable: true,
      complete: true,
      error: null,
    };
    sources.branchProtection = {
      required: branchProtection !== null,
      readable: true,
      complete: true,
      error: null,
    };
    evidence.branchProtection = branchProtection;
    evidence.policy = {
      branchProtectionRules: {
        pageInfo: { hasNextPage: false },
        nodes: branchProtection === null ? [] : [{ pattern: base }],
      },
      latestOpinionatedReviews,
      mergeQueue: policy.mergeQueue || {
        enabled: false,
        inQueue: false,
        entry: null,
      },
    };
  }

  if (actor) {
    if (!SAFE_ACTOR.test(actor)) throw new Error("Actions actor is invalid");
    sources.viewer = {
      required: true,
      readable: true,
      complete: true,
      error: null,
    };
    evidence.viewer = { login: actor, source: "github-actions-environment" };
  }

  return createSnapshotEnvelope({
    repo: snapshot.repo,
    pr: snapshot.pr,
    headOid: snapshot.headOid,
    capturedAt: snapshot.capturedAt,
    sources,
    evidence,
  });
}
