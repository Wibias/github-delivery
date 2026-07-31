#!/usr/bin/env node
/**
 * Merge-queue + review-policy gates for a PR.
 * Usage: node scripts/pr-policy-gate.mjs OWNER/REPO PR_NUMBER
 * Requires: gh auth
 */
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  evaluateReviewPolicy,
  maxRequiredApprovalCount,
} from "./lib/review-policy.mjs";

const [repo, prRaw] = process.argv.slice(2);
const pr = Number(prRaw);
if (!repo || !repo.includes("/") || !Number.isInteger(pr) || pr <= 0) {
  console.error("Usage: node scripts/pr-policy-gate.mjs OWNER/REPO PR_NUMBER");
  process.exit(2);
}
const [owner, name] = repo.split("/");

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `gh failed (${r.status})`);
  }
  return JSON.parse(r.stdout || "null");
}

function ghOk(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function apiPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function fetchAllReviews() {
  const reviews = [];
  for (let page = 1; page <= 100; page++) {
    const chunk = ghJson([
      "api",
      `repos/${owner}/${name}/pulls/${pr}/reviews?per_page=100&page=${page}`,
    ]);
    if (!Array.isArray(chunk)) throw new Error("Unexpected pull-request reviews response");
    reviews.push(
      ...chunk.map((review) => ({
        author: { login: review.user?.login || null },
        state: review.state,
        submittedAt: review.submitted_at,
        commit: { oid: review.commit_id || null },
      })),
    );
    if (chunk.length < 100) return { reviews, complete: true, pages: page };
  }
  return { reviews, complete: false, pages: 100 };
}

function scanTargetWorkflows(base, mergeQueueEnabled) {
  const listing = ghOk([
    "api",
    `repos/${owner}/${name}/contents/.github/workflows?ref=${encodeURIComponent(base)}`,
  ]);
  if (!listing.ok) {
    return {
      complete: false,
      workflowFiles: 0,
      hasMergeGroupTrigger: null,
      hasPullRequestTrigger: null,
      warning: mergeQueueEnabled
        ? "Merge queue is enabled, but target-base workflow files could not be inspected."
        : null,
    };
  }

  let entries;
  try {
    entries = JSON.parse(listing.stdout);
  } catch {
    return { complete: false, error: "Could not parse target workflow listing" };
  }
  if (!Array.isArray(entries)) {
    return { complete: false, error: "Unexpected target workflow listing" };
  }

  const workflowFiles = entries.filter(
    (entry) => entry?.type === "file" && /\.ya?ml$/i.test(entry.name || ""),
  );
  let hasMergeGroupTrigger = false;
  let hasPullRequestTrigger = false;
  let complete = true;

  for (const entry of workflowFiles) {
    const file = ghOk([
      "api",
      `repos/${owner}/${name}/contents/${apiPath(entry.path)}?ref=${encodeURIComponent(base)}`,
    ]);
    if (!file.ok) {
      complete = false;
      continue;
    }
    try {
      const meta = JSON.parse(file.stdout);
      const text = Buffer.from(meta.content || "", "base64").toString("utf8");
      if (/\bmerge_group\b/.test(text)) hasMergeGroupTrigger = true;
      if (/\bpull_request(?:_target)?\b/.test(text)) hasPullRequestTrigger = true;
    } catch {
      complete = false;
    }
  }

  return {
    complete,
    scannedRef: base,
    workflowFiles: workflowFiles.length,
    hasMergeGroupTrigger,
    hasPullRequestTrigger,
    warning:
      mergeQueueEnabled && complete && !hasMergeGroupTrigger
        ? "Merge queue enabled but no target-base workflow mentions merge_group; queue checks may stall."
        : null,
  };
}

const query = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      branchProtectionRules(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          pattern
          requiresCodeOwnerReviews
          dismissesStaleReviews
          requireLastPushApproval
          requiredApprovingReviewCount
          requiresApprovingReviews
          requiresConversationResolution
        }
      }
      pullRequest(number: $number) {
        url
        baseRefName
        headRefOid
        reviewDecision
        isDraft
        mergeStateStatus
        isInMergeQueue
        isMergeQueueEnabled
        mergeQueueEntry {
          position
          state
          enqueuedAt
          estimatedTimeToMerge
        }
        commits(last: 1) {
          nodes { commit { oid committedDate } }
        }
      }
    }
  }`;

const gql = ghJson([
  "api",
  "graphql",
  "-f",
  `query=${query}`,
  "-F",
  `owner=${owner}`,
  "-F",
  `name=${name}`,
  "-F",
  `number=${pr}`,
]);

if (gql.errors?.length) {
  console.error(JSON.stringify(gql.errors, null, 2));
  process.exit(1);
}

const repoNode = gql.data?.repository;
const prNode = repoNode?.pullRequest;
if (!prNode) {
  console.error("PR not found");
  process.exit(1);
}

const base = prNode.baseRefName;
const headOid = prNode.headRefOid;
const lastCommitOid = prNode.commits?.nodes?.[0]?.commit?.oid || headOid;

function patternMatchesBranch(pattern, branch) {
  if (!pattern) return false;
  if (pattern === branch) return true;
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "<<<STARSTAR>>>")
        .replace(/\*/g, "[^/]*")
        .replace(/<<<STARSTAR>>>/g, ".*") +
      "$",
  );
  return re.test(branch);
}

const branchRulesConnection = repoNode.branchProtectionRules || {};
const matchingRules = (branchRulesConnection.nodes || []).filter((rule) =>
  patternMatchesBranch(rule.pattern, base),
);

let restProtection = null;
const protectionResponse = ghOk([
  "api",
  `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
]);
if (protectionResponse.ok) {
  try {
    const body = JSON.parse(protectionResponse.stdout);
    const reviews = body.required_pull_request_reviews;
    restProtection = {
      requiresApprovingReviews: reviews !== null && reviews !== undefined,
      requiresCodeOwnerReviews: reviews?.require_code_owner_reviews ?? null,
      dismissesStaleReviews: reviews?.dismiss_stale_reviews ?? null,
      requireLastPushApproval: reviews?.require_last_push_approval ?? null,
      requiredApprovingReviewCount: reviews?.required_approving_review_count ?? null,
    };
  } catch {
    restProtection = null;
  }
}

const rulesetPullRequest = [];
const rulesResponse = ghOk([
  "api",
  `repos/${owner}/${name}/rules/branches/${encodeURIComponent(base)}`,
]);
if (rulesResponse.ok) {
  try {
    const list = JSON.parse(rulesResponse.stdout);
    if (Array.isArray(list)) {
      for (const rule of list) {
        if (rule?.type === "pull_request" && rule.parameters) {
          rulesetPullRequest.push({
            require_code_owner_review: rule.parameters.require_code_owner_review ?? null,
            dismiss_stale_reviews_on_push: rule.parameters.dismiss_stale_reviews_on_push ?? null,
            require_last_push_approval: rule.parameters.require_last_push_approval ?? null,
            required_approving_review_count:
              rule.parameters.required_approving_review_count ?? null,
            required_review_thread_resolution:
              rule.parameters.required_review_thread_resolution ?? null,
          });
        }
        if (rule?.type === "merge_queue") {
          rulesetPullRequest.push({ merge_queue_rule: true, parameters: rule.parameters || {} });
        }
      }
    }
  } catch {
    // Keep the source marked unavailable below.
  }
}

const requiredApprovalCount = maxRequiredApprovalCount({
  matchingRules,
  restProtection,
  rulesetPullRequest,
});
const requiresApprovingReviews = Boolean(
  matchingRules.some((rule) => rule.requiresApprovingReviews) ||
    restProtection?.requiresApprovingReviews ||
    requiredApprovalCount > 0,
);
const requiresCodeOwnerReviews = Boolean(
  matchingRules.some((rule) => rule.requiresCodeOwnerReviews) ||
    restProtection?.requiresCodeOwnerReviews ||
    rulesetPullRequest.some((rule) => rule.require_code_owner_review === true),
);
const dismissesStaleReviews = Boolean(
  matchingRules.some((rule) => rule.dismissesStaleReviews) ||
    restProtection?.dismissesStaleReviews ||
    rulesetPullRequest.some((rule) => rule.dismiss_stale_reviews_on_push === true),
);
const requireLastPushApproval = Boolean(
  matchingRules.some((rule) => rule.requireLastPushApproval) ||
    restProtection?.requireLastPushApproval ||
    rulesetPullRequest.some((rule) => rule.require_last_push_approval === true),
);
const requiresConversationResolution = Boolean(
  matchingRules.some((rule) => rule.requiresConversationResolution) ||
    rulesetPullRequest.some((rule) => rule.required_review_thread_resolution === true),
);

const reviewFetch = fetchAllReviews();
const evaluation = evaluateReviewPolicy({
  isDraft: prNode.isDraft,
  reviewDecision: prNode.reviewDecision,
  requiresApprovingReviews,
  requiresCodeOwnerReviews,
  requireLastPushApproval,
  requiresConversationResolution,
  requiredApprovalCount,
  reviews: reviewFetch.reviews,
});

const approvalsOnHead = evaluation.approvals.filter(
  (review) => review.commit?.oid === headOid,
);
const staleApprovals = evaluation.approvals.filter(
  (review) => review.commit?.oid && review.commit.oid !== headOid,
);
const blockers = [...evaluation.blockers];
const policyDataComplete =
  branchRulesConnection.pageInfo?.hasNextPage !== true && reviewFetch.complete;
if (!policyDataComplete) blockers.push("policy_data_incomplete");
if (requiresApprovingReviews && !prNode.reviewDecision) {
  blockers.push("review_decision_unknown");
}
if (prNode.isInMergeQueue && prNode.mergeStateStatus !== "CLEAN") {
  blockers.push("merge_queue_not_merged");
}

const mergeGroupWorkflowCoverage = scanTargetWorkflows(
  base,
  prNode.isMergeQueueEnabled,
);

const out = {
  repo,
  pr,
  base,
  headOid,
  lastCommitOid,
  url: prNode.url,
  complete: policyDataComplete,
  mergeQueue: {
    enabled: prNode.isMergeQueueEnabled,
    inQueue: prNode.isInMergeQueue,
    entry: prNode.mergeQueueEntry || null,
    note: prNode.isInMergeQueue
      ? "PR is in merge queue; watch until merged or closed. Queued is not merged."
      : prNode.isMergeQueueEnabled
        ? "Base has merge queue; prefer queue merge and wait for the terminal state."
        : "No merge queue on base.",
  },
  mergeGroupWorkflowCoverage,
  reviewPolicy: {
    matchingBranchProtectionPatterns: matchingRules.map((rule) => rule.pattern),
    requiresApprovingReviews,
    requiredApprovalCount,
    requiresCodeOwnerReviews,
    dismissesStaleReviews,
    requireLastPushApproval,
    requiresConversationResolution,
    requiredFollowUpChecks: requiresConversationResolution ? ["review-threads"] : [],
    restProtection,
    rulesetPullRequest,
    sources: {
      branchProtectionGraphqlComplete:
        branchRulesConnection.pageInfo?.hasNextPage !== true,
      classicProtectionReadable: protectionResponse.ok,
      rulesetsReadable: rulesResponse.ok,
      reviewsPages: reviewFetch.pages,
      reviewsComplete: reviewFetch.complete,
    },
    codeownersNote: requiresCodeOwnerReviews
      ? "CODEOWNERS reviews are enforced; GitHub reviewDecision remains authoritative."
      : "CODEOWNERS may suggest reviewers without enforcing approval.",
    conversationNote: requiresConversationResolution
      ? "Conversation resolution is enabled. Run review-threads.mjs; the policy alone is not a blocker when zero threads remain."
      : "Conversation resolution is not required by the detected policy.",
    lastPushNote: requireLastPushApproval
      ? "GitHub reviewDecision is authoritative for last-push approval; approvals are not approximated from commit timestamps."
      : null,
  },
  approvals: {
    reviewDecision: prNode.reviewDecision,
    effective: evaluation.approvals.map((review) => review.author?.login),
    onHeadSha: approvalsOnHead.map((review) => review.author?.login),
    staleAfterPush: staleApprovals.map((review) => ({
      login: review.author?.login,
      commit: review.commit?.oid,
      submittedAt: review.submittedAt,
    })),
    changesRequested: evaluation.changesRequested.map(
      (review) => review.author?.login,
    ),
  },
  blockers: [...new Set(blockers)],
  mergeStateStatus: prNode.mergeStateStatus,
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exitCode = out.blockers.length ? 1 : 0;
