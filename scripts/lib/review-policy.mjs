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

function reviewTimestamp(review) {
  const value = Date.parse(review?.submittedAt || review?.submitted_at || "");
  return Number.isFinite(value) ? value : 0;
}

function reviewAuthor(review) {
  return review?.author?.login || review?.user?.login || null;
}

function reviewState(review) {
  return String(review?.state || "").toUpperCase();
}

export function reduceEffectiveReviews(reviews) {
  const latestByAuthor = new Map();
  const ordered = [...(reviews || [])].sort((a, b) => reviewTimestamp(a) - reviewTimestamp(b));

  for (const review of ordered) {
    const author = reviewAuthor(review);
    const state = reviewState(review);
    if (!author || state === "COMMENTED" || state === "PENDING") continue;

    if (state === "DISMISSED") {
      latestByAuthor.delete(author);
      continue;
    }

    if (state === "APPROVED" || state === "CHANGES_REQUESTED") {
      latestByAuthor.set(author, review);
    }
  }

  return [...latestByAuthor.values()];
}

export function maxRequiredApprovalCount({
  matchingRules = [],
  restProtection = null,
  rulesetPullRequest = [],
} = {}) {
  const values = [
    ...matchingRules.map((rule) => rule?.requiredApprovingReviewCount),
    restProtection?.requiredApprovingReviewCount,
    ...rulesetPullRequest.map((rule) => rule?.required_approving_review_count),
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);

  return values.length ? Math.max(...values) : 0;
}

export function evaluateReviewPolicy({
  isDraft = false,
  reviewDecision = null,
  requiresApprovingReviews = false,
  requiresCodeOwnerReviews = false,
  requireLastPushApproval = false,
  requiresConversationResolution = false,
  requiredApprovalCount = 0,
  reviews = [],
} = {}) {
  const effectiveReviews = reduceEffectiveReviews(reviews);
  const approvals = effectiveReviews.filter((review) => reviewState(review) === "APPROVED");
  const changesRequested = effectiveReviews.filter(
    (review) => reviewState(review) === "CHANGES_REQUESTED",
  );
  const decision = String(reviewDecision || "").toUpperCase();
  const blockers = [];

  if (isDraft) blockers.push("draft");
  if (decision === "CHANGES_REQUESTED" || changesRequested.length > 0) {
    blockers.push("changes_requested");
  }
  if (decision === "REVIEW_REQUIRED") {
    blockers.push("review_required");
  }
  if (requiredApprovalCount > approvals.length) {
    blockers.push("required_approvals_missing");
  }
  if (requiresCodeOwnerReviews && decision !== "APPROVED") {
    blockers.push("code_owner_review_required");
  }
  if (requireLastPushApproval && decision !== "APPROVED") {
    blockers.push("last_push_approval_needed");
  }

  return {
    blockers: [...new Set(blockers)],
    effectiveReviews,
    approvals,
    changesRequested,
    requiredApprovalCount,
    conversationResolutionCheckRequired: requiresConversationResolution,
  };
}
