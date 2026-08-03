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

function reviewLogin(review) {
  return review?.user?.login || review?.author?.login || null;
}

function reviewState(review) {
  return String(review?.state || "").toUpperCase();
}

function reviewSubmittedAt(review) {
  return review?.submitted_at || review?.submittedAt || null;
}

function reviewCommitOid(review) {
  return review?.commit_id || review?.commit?.oid || null;
}

export function latestOpinionatedReviewsFromRest(reviews = []) {
  const latest = new Map();
  for (const review of reviews) {
    const login = reviewLogin(review);
    const state = reviewState(review);
    if (!login || !new Set(["APPROVED", "CHANGES_REQUESTED"]).has(state)) {
      continue;
    }
    latest.set(login, {
      author: { login },
      state,
      submittedAt: reviewSubmittedAt(review),
      commit: reviewCommitOid(review)
        ? { oid: reviewCommitOid(review) }
        : null,
    });
  }
  return {
    pageInfo: { hasNextPage: false },
    nodes: [...latest.values()],
  };
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
  if (!snapshot || snapshot.kind !== "github-delivery/evidence-snapshot") {
    throw new Error("snapshot must be a github-delivery evidence snapshot");
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
