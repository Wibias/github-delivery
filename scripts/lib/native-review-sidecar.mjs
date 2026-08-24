function normalizeLogin(value) {
  return String(value || "").trim().toLowerCase();
}

function reviewLogin(review) {
  return normalizeLogin(review?.user?.login || review?.author?.login);
}

function reviewNodeId(review) {
  for (const candidate of [review?.node_id, review?.nodeId, review?.id]) {
    if (typeof candidate === "string" && candidate.startsWith("PRR")) return candidate;
  }
  return null;
}

function ownedPendingChangesRequested(reviews, viewerLogin) {
  const viewer = normalizeLogin(viewerLogin);
  if (!viewer) return [];
  return (Array.isArray(reviews) ? reviews : []).filter((review) => {
    const state = String(review?.state || "").toUpperCase();
    return (
      state === "CHANGES_REQUESTED" &&
      reviewLogin(review) === viewer &&
      Boolean(reviewNodeId(review))
    );
  });
}

export function nativeReviewSidecarBody({ label, expectedHead } = {}) {
  const head = String(expectedHead || "").trim();
  const labelText = String(label || "").trim();
  return `Native review sidecar: ${labelText} on ${head}. The format-valid verdict remains the [GD] Verdict comment on this head.`;
}

export function canSubmitNativeRequestChanges({
  viewerLogin,
  authorLogin,
  canRequestChanges,
} = {}) {
  const viewer = normalizeLogin(viewerLogin);
  const author = normalizeLogin(authorLogin);
  if (!viewer) return { allowed: false, reason: "viewer_missing" };
  if (!author) return { allowed: false, reason: "author_missing" };
  if (viewer === author) return { allowed: false, reason: "own_pull_request" };
  if (canRequestChanges !== true) return { allowed: false, reason: "permission_missing" };
  return { allowed: true, reason: null };
}

function dismissOperation({
  review,
  viewerLogin,
  repo,
  pr,
  expectedHead,
  mutationMode,
}) {
  return {
    schemaVersion: 1,
    action: "dismiss_review",
    mutationMode,
    repo,
    pr,
    expectedHead,
    reviewId: reviewNodeId(review),
    actorLogin: viewerLogin,
    message: "Superseded by a later github-delivery review pass.",
  };
}

export function planNativeReviewSidecar({
  label,
  viewerLogin,
  authorLogin,
  canRequestChanges,
  reviews = [],
  repo,
  pr,
  expectedHead,
  mutationMode = "review",
} = {}) {
  const pending = ownedPendingChangesRequested(reviews, viewerLogin);
  const operations = [];
  const skipReasons = [];
  let skippedRequestChanges = false;
  const shouldDismiss =
    label === "changes-requested" || label === "approve-comment";

  if (shouldDismiss) {
    for (const review of pending) {
      operations.push(
        dismissOperation({
          review,
          viewerLogin,
          repo,
          pr,
          expectedHead,
          mutationMode,
        }),
      );
    }
  }

  if (label === "changes-requested") {
    const eligibility = canSubmitNativeRequestChanges({
      viewerLogin,
      authorLogin,
      canRequestChanges,
    });
    if (!eligibility.allowed) {
      skippedRequestChanges = true;
      skipReasons.push(eligibility.reason);
    } else {
      operations.push({
        schemaVersion: 1,
        action: "post_review",
        mutationMode,
        event: "request-changes",
        repo,
        pr,
        expectedHead,
        idempotencyKey: `native-review-sidecar:${pr}:${expectedHead}:request-changes`,
        body: nativeReviewSidecarBody({ label, expectedHead }),
      });
    }
  }

  return {
    operations,
    skippedRequestChanges,
    skipReasons,
    dismissedReviewIds: shouldDismiss
      ? pending.map((review) => reviewNodeId(review))
      : [],
  };
}
