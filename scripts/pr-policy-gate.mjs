#!/usr/bin/env node
/**
 * Merge-queue + review-policy gates for a PR (code-owner enforcement, stale approvals, last-push).
 * Usage: node scripts/pr-policy-gate.mjs OWNER/REPO PR_NUMBER
 * Requires: gh auth
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [repo, prRaw] = process.argv.slice(2);
if (!repo || !prRaw || !repo.includes("/")) {
  console.error("Usage: node scripts/pr-policy-gate.mjs OWNER/REPO PR_NUMBER");
  process.exit(2);
}
const pr = Number(prRaw);
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

const query = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      branchProtectionRules(first: 50) {
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
        reviews(last: 30, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
          nodes {
            author { login }
            state
            submittedAt
            commit { oid }
          }
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
  // simple glob: * and **
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

const matchingRules = (repoNode.branchProtectionRules?.nodes || []).filter((r) =>
  patternMatchesBranch(r.pattern, base),
);

// Classic REST protection (may 404)
let restProtection = null;
const prot = ghOk([
  "api",
  `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
]);
if (prot.ok) {
  try {
    const body = JSON.parse(prot.stdout);
    restProtection = {
      requiresCodeOwnerReviews: body.required_pull_request_reviews?.require_code_owner_reviews ?? null,
      dismissesStaleReviews: body.required_pull_request_reviews?.dismiss_stale_reviews ?? null,
      requireLastPushApproval:
        body.required_pull_request_reviews?.require_last_push_approval ?? null,
      requiredApprovingReviewCount:
        body.required_pull_request_reviews?.required_approving_review_count ?? null,
    };
  } catch {
    restProtection = null;
  }
}

// Rulesets pull_request parameters
let rulesetPullRequest = [];
const rules = ghOk([
  "api",
  `repos/${owner}/${name}/rules/branches/${encodeURIComponent(base)}`,
]);
if (rules.ok) {
  try {
    const list = JSON.parse(rules.stdout);
    if (Array.isArray(list)) {
      for (const rule of list) {
        if (rule?.type === "pull_request" && rule.parameters) {
          rulesetPullRequest.push({
            require_code_owner_review: rule.parameters.require_code_owner_review ?? null,
            dismiss_stale_reviews_on_push: rule.parameters.dismiss_stale_reviews_on_push ?? null,
            require_last_push_approval: rule.parameters.require_last_push_approval ?? null,
            required_approving_review_count: rule.parameters.required_approving_review_count ?? null,
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
    // ignore
  }
}

const requiresCodeOwnerReviews = Boolean(
  matchingRules.some((r) => r.requiresCodeOwnerReviews) ||
    restProtection?.requiresCodeOwnerReviews ||
    rulesetPullRequest.some((r) => r.require_code_owner_review === true),
);

const dismissesStaleReviews = Boolean(
  matchingRules.some((r) => r.dismissesStaleReviews) ||
    restProtection?.dismissesStaleReviews ||
    rulesetPullRequest.some((r) => r.dismiss_stale_reviews_on_push === true),
);

const requireLastPushApproval = Boolean(
  matchingRules.some((r) => r.requireLastPushApproval) ||
    restProtection?.requireLastPushApproval ||
    rulesetPullRequest.some((r) => r.require_last_push_approval === true),
);

const requiresConversationResolution = Boolean(
  matchingRules.some((r) => r.requiresConversationResolution) ||
    rulesetPullRequest.some((r) => r.required_review_thread_resolution === true),
);

// Approvals vs head SHA (stale after push)
const reviews = prNode.reviews?.nodes || [];
const approvalsOnHead = reviews.filter(
  (r) => r.state === "APPROVED" && r.commit?.oid === headOid,
);
const approvalsAny = reviews.filter((r) => r.state === "APPROVED");
const staleApprovals = approvalsAny.filter((r) => r.commit?.oid && r.commit.oid !== headOid);
const changesRequested = reviews.filter((r) => r.state === "CHANGES_REQUESTED");

let mergeGroupWorkflowCoverage = null;
const wfDir = join(process.cwd(), ".github", "workflows");
if (existsSync(wfDir)) {
  try {
    const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/i.test(f));
    let anyMergeGroup = false;
    let anyPullRequest = false;
    for (const f of files) {
      const text = readFileSync(join(wfDir, f), "utf8");
      if (/merge_group\s*:/.test(text) || /merge_group/.test(text)) anyMergeGroup = true;
      if (/pull_request\s*:/.test(text) || /pull_request_target\s*:/.test(text)) anyPullRequest = true;
    }
    mergeGroupWorkflowCoverage = {
      scannedDir: wfDir,
      workflowFiles: files.length,
      hasMergeGroupTrigger: anyMergeGroup,
      hasPullRequestTrigger: anyPullRequest,
      warning:
        prNode.isMergeQueueEnabled && !anyMergeGroup
          ? "Merge queue enabled but no local workflow mentions merge_group — queue checks may stall if CI only runs on pull_request."
          : null,
    };
  } catch {
    mergeGroupWorkflowCoverage = { scannedDir: wfDir, error: "could not read workflows" };
  }
}

const blockers = [];
if (prNode.isDraft) blockers.push("draft");
if (prNode.reviewDecision === "CHANGES_REQUESTED" || changesRequested.length)
  blockers.push("changes_requested");
if (requiresCodeOwnerReviews && prNode.reviewDecision === "REVIEW_REQUIRED")
  blockers.push("code_owner_or_review_required");
if (dismissesStaleReviews && staleApprovals.length && approvalsOnHead.length === 0)
  blockers.push("stale_approvals_after_push");
if (requireLastPushApproval && approvalsOnHead.length === 0 && prNode.reviewDecision !== "APPROVED")
  blockers.push("last_push_approval_needed");
if (requiresConversationResolution)
  blockers.push("conversation_resolution_required_run_review_threads");

const out = {
  repo,
  pr,
  base,
  headOid,
  lastCommitOid,
  url: prNode.url,
  mergeQueue: {
    enabled: prNode.isMergeQueueEnabled,
    inQueue: prNode.isInMergeQueue,
    entry: prNode.mergeQueueEntry || null,
    note: prNode.isInMergeQueue
      ? "PR is in merge queue — watch until merged/closed; do not claim done at 'queued'."
      : prNode.isMergeQueueEnabled
        ? "Base has merge queue — prefer enqueue/merge via queue; wait for actual merge."
        : "No merge queue on base.",
  },
  mergeGroupWorkflowCoverage,
  reviewPolicy: {
    matchingBranchProtectionPatterns: matchingRules.map((r) => r.pattern),
    requiresCodeOwnerReviews,
    dismissesStaleReviews,
    requireLastPushApproval,
    requiresConversationResolution,
    restProtection,
    rulesetPullRequest,
    codeownersNote: requiresCodeOwnerReviews
      ? "CODEOWNERS reviews are enforced."
      : "CODEOWNERS may only suggest reviewers (enforcement off) — still triage owners; do not treat suggestion-only as merge block unless reviewDecision/requests say otherwise.",
  },
  approvals: {
    reviewDecision: prNode.reviewDecision,
    onHeadSha: approvalsOnHead.map((r) => r.author?.login),
    staleAfterPush: staleApprovals.map((r) => ({
      login: r.author?.login,
      commit: r.commit?.oid,
      submittedAt: r.submittedAt,
    })),
    changesRequested: changesRequested.map((r) => r.author?.login),
  },
  blockers,
  mergeStateStatus: prNode.mergeStateStatus,
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exitCode = blockers.length || (prNode.isInMergeQueue && prNode.mergeStateStatus !== "CLEAN")
  ? 1
  : 0;
