import {
  extractTldrBullets,
  findCompletedVerdictsForHead,
} from "./verdict-publication.mjs";

const REQUIRED_AXES = ["bugs", "security", "spec/standards"];
const INCOMPLETE_VALUE_RE = /\b(?:pending|unknown|not\s+run|not\s+reviewed|missing|incomplete|blocked)\b/i;

function commentLogin(comment = {}) {
  return String(comment?.user?.login || comment?.author?.login || "").toLowerCase();
}

export function mergeReviewEvidenceForSnapshot(snapshot = {}) {
  const head = String(snapshot?.headOid || "").toLowerCase();
  if (!head) throw new Error("merge_review_head_missing");
  const viewer = String(snapshot?.evidence?.viewer?.login || "").toLowerCase();
  if (!viewer) throw new Error("merge_review_viewer_missing");
  const comments = snapshot?.evidence?.feedback?.issueComments;
  if (!Array.isArray(comments)) throw new Error("merge_review_comments_missing");

  const completed = findCompletedVerdictsForHead({ comments, head }).filter(
    (entry) => commentLogin(entry.comment) === viewer,
  );
  if (!completed.length) {
    throw new Error("merge_review_evidence_missing: no completed same-head github-delivery verdict from the authenticated actor");
  }

  const latest = completed[completed.length - 1];
  if (latest.label !== "approve-comment") {
    throw new Error(`merge_review_not_approved:${latest.label || "missing"}`);
  }

  const bullets = extractTldrBullets(latest.comment?.body || "");
  for (const axis of REQUIRED_AXES) {
    const value = String(bullets[axis] || "").trim();
    if (!value || INCOMPLETE_VALUE_RE.test(value)) {
      throw new Error(`merge_review_axis_incomplete:${axis}`);
    }
  }

  return Object.freeze({
    head,
    actor: viewer,
    commentId: latest.comment?.id ?? null,
    url: latest.comment?.html_url || latest.comment?.url || null,
    runId: latest.runId,
    label: latest.label,
    axes: Object.fromEntries(REQUIRED_AXES.map((axis) => [axis, bullets[axis]])),
  });
}

export function assertSameMergeReviewEvidence(expected = {}, snapshot = {}) {
  const observed = mergeReviewEvidenceForSnapshot(snapshot);
  for (const field of ["head", "actor", "commentId", "runId", "label"]) {
    if (observed[field] !== expected[field]) {
      throw new Error(
        `merge_review_evidence_changed:${field}: expected ${expected[field] ?? "missing"}, observed ${observed[field] ?? "missing"}`,
      );
    }
  }
  return observed;
}
