import {
  extractTldrBullets,
  findCompletedVerdictsForHead,
} from "./verdict-publication.mjs";
import { authorityVerifierConfiguration } from "./mutation-execution-context.mjs";
import { verifyReviewVerdictProvenance } from "./review-verdict-provenance.mjs";

const REQUIRED_AXES = ["bugs", "security", "spec/standards"];
const INCOMPLETE_VALUE_RE = /\b(?:pending|unknown|not\s+run|not\s+reviewed|missing|incomplete|blocked)\b/i;

function commentLogin(comment = {}) {
  return String(comment?.user?.login || comment?.author?.login || "").toLowerCase();
}

export function mergeReviewEvidenceForSnapshot(
  snapshot = {},
  { authorityVerifier = undefined, env = process.env, readFile = undefined } = {},
) {
  const head = String(snapshot?.headOid || "").toLowerCase();
  if (!head) throw new Error("merge_review_head_missing");
  const repo = String(snapshot?.repo || "");
  const pr = Number(snapshot?.pr);
  if (!repo || !Number.isInteger(pr) || pr <= 0) {
    throw new Error("merge_review_target_missing");
  }
  const viewer = String(snapshot?.evidence?.viewer?.login || "").toLowerCase();
  if (!viewer) throw new Error("merge_review_viewer_missing");
  const comments = snapshot?.evidence?.feedback?.issueComments;
  if (!Array.isArray(comments)) throw new Error("merge_review_comments_missing");

  const verifier =
    authorityVerifier === undefined
      ? authorityVerifierConfiguration({
          env,
          ...(readFile ? { readFile } : {}),
        })
      : authorityVerifier;
  if (!verifier) {
    throw new Error("merge_review_authority_verifier_missing");
  }

  const completed = findCompletedVerdictsForHead({ comments, head }).filter(
    (entry) => commentLogin(entry.comment) === viewer,
  );
  if (!completed.length) {
    throw new Error("merge_review_evidence_missing: no completed same-head github-delivery verdict from the authenticated actor");
  }

  const trusted = [];
  const rejected = [];
  for (const entry of completed) {
    const provenance = verifyReviewVerdictProvenance({
      comment: entry.comment,
      repo,
      pr,
      head,
      publicKey: verifier,
    });
    if (provenance.valid) trusted.push({ ...entry, provenance });
    else rejected.push(provenance.reason);
  }
  if (!trusted.length) {
    throw new Error(
      `merge_review_authority_missing:${rejected.at(-1) || "unverified_verdict"}`,
    );
  }

  const latest = trusted[trusted.length - 1];
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
    authorityScopeSha256: latest.provenance.authority?.claims?.scopeSha256 ?? null,
    authorityNonce: latest.provenance.authority?.claims?.nonce ?? null,
    approvalMethod: latest.provenance.authority?.claims?.approvalMethod ?? null,
  });
}

export function assertSameMergeReviewEvidence(expected = {}, snapshot = {}, options = {}) {
  const observed = mergeReviewEvidenceForSnapshot(snapshot, options);
  for (const field of [
    "head",
    "actor",
    "commentId",
    "runId",
    "label",
    "authorityScopeSha256",
    "authorityNonce",
    "approvalMethod",
  ]) {
    if (observed[field] !== expected[field]) {
      throw new Error(
        `merge_review_evidence_changed:${field}: expected ${expected[field] ?? "missing"}, observed ${observed[field] ?? "missing"}`,
      );
    }
  }
  return observed;
}
