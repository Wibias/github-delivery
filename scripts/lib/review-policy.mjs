export function parseReviewThreadArgs(argv) {
  const positionals = [];
  let resolveId = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--resolve") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--resolve requires a review thread ID");
      }
      if (resolveId !== null) {
        throw new Error("--resolve may only be provided once");
      }
      resolveId = value;
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  if (positionals.length !== 2) {
    throw new Error(
      "Usage: node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--resolve PRRT_xxx]",
    );
  }

  const [repo, prRaw] = positionals;
  const pr = Number(prRaw);
  if (!repo.includes("/") || !Number.isInteger(pr) || pr <= 0) {
    throw new Error(
      "Usage: node scripts/review-threads.mjs OWNER/REPO PR_NUMBER [--resolve PRRT_xxx]",
    );
  }

  return { repo, pr, resolveId };
}

function reviewAuthor(review) {
  return review?.author?.login || review?.user?.login || null;
}

function reviewState(review) {
  return String(review?.state || "").toUpperCase();
}

export function summarizeLatestOpinionatedReviews(reviews = []) {
  const approvals = [];
  const changesRequested = [];

  for (const review of reviews) {
    const author = reviewAuthor(review);
    const state = reviewState(review);
    if (!author) continue;

    if (state === "APPROVED") approvals.push(review);
    if (state === "CHANGES_REQUESTED") changesRequested.push(review);
  }

  return { approvals, changesRequested };
}

export function maxRequiredApprovalCount({
  restProtection = null,
  activePullRequestRules = [],
} = {}) {
  const values = [
    restProtection?.requiredApprovingReviewCount,
    ...activePullRequestRules.map(
      (rule) => rule?.required_approving_review_count,
    ),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);

  return values.length ? Math.max(...values) : 0;
}

export function evaluatePolicyDataCompleteness({
  branchProtectionGraphqlComplete = false,
  matchingClassicRuleCount = 0,
  classicProtectionReadable = false,
  activeRulesComplete = false,
} = {}) {
  const reasons = [];

  if (!branchProtectionGraphqlComplete) {
    reasons.push("classic_branch_rules_incomplete");
  }
  if (matchingClassicRuleCount > 0 && !classicProtectionReadable) {
    reasons.push("effective_classic_protection_unreadable");
  }
  if (!activeRulesComplete) {
    reasons.push("active_rules_incomplete");
  }

  return {
    complete: reasons.length === 0,
    reasons,
  };
}

export function evaluateReviewPolicy({
  isDraft = false,
  reviewDecision = null,
  requiresApprovingReviews = false,
  requiresCodeOwnerReviews = false,
  requireLastPushApproval = false,
  requiresConversationResolution = false,
  requiredApprovalCount = 0,
  latestOpinionatedReviews = [],
} = {}) {
  const { approvals, changesRequested } =
    summarizeLatestOpinionatedReviews(latestOpinionatedReviews);
  const decision = String(reviewDecision || "").toUpperCase();
  const blockers = [];

  if (isDraft) blockers.push("draft");
  if (decision === "CHANGES_REQUESTED") {
    blockers.push("changes_requested");
  }
  if (decision === "REVIEW_REQUIRED") {
    blockers.push("review_required");
    if (requiredApprovalCount > 0) {
      blockers.push("required_approvals_missing");
    }
    if (requiresCodeOwnerReviews) {
      blockers.push("code_owner_review_required");
    }
    if (requireLastPushApproval) {
      blockers.push("last_push_approval_needed");
    }
  }
  if (
    !decision &&
    (requiresApprovingReviews ||
      requiresCodeOwnerReviews ||
      requireLastPushApproval ||
      requiredApprovalCount > 0)
  ) {
    blockers.push("review_decision_unknown");
  }

  return {
    blockers: [...new Set(blockers)],
    approvals,
    changesRequested,
    requiredApprovalCount,
    conversationResolutionCheckRequired: requiresConversationResolution,
  };
}
