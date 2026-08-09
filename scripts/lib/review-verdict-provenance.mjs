import { verifyAuthorityGrant } from "./authority-grant.mjs";
import {
  isFullReviewVerdictBody,
  parseFullReviewMarker,
  parseReviewAuthorityMarker,
  stripReviewAuthorityMarker,
} from "./review-verdict-marker.mjs";

const IDEMPOTENCY_MARKER_RE =
  /\n\n<!-- github-delivery:idempotency [0-9a-f]{64} -->\s*$/i;

function commentCreatedAt(comment = {}) {
  const value = comment.created_at ?? comment.createdAt ?? null;
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "review_authority_comment_time_missing" };
  }
  return { ok: true, now: Math.floor(timestamp / 1000) };
}

function visibleBody(body) {
  return stripReviewAuthorityMarker(String(body || "").replace(IDEMPOTENCY_MARKER_RE, ""));
}

export function verifyReviewVerdictProvenance({
  comment,
  repo,
  pr,
  head,
  publicKey = null,
  trustStore = null,
} = {}) {
  const body = String(comment?.body || "");
  if (!isFullReviewVerdictBody(body)) {
    return { valid: false, reason: "review_verdict_format_marker_missing" };
  }
  const verdictMarker = parseFullReviewMarker(body);
  if (!verdictMarker || verdictMarker.head !== String(head || "")) {
    return { valid: false, reason: "review_verdict_head_mismatch" };
  }
  const authorityMarker = parseReviewAuthorityMarker(body);
  if (!authorityMarker) {
    return { valid: false, reason: "review_authority_marker_missing" };
  }
  const time = commentCreatedAt(comment);
  if (!time.ok) return { valid: false, reason: time.reason };

  const request = {
    schemaVersion: 1,
    action: "post_comment",
    mutationMode: authorityMarker.mode,
    repo: String(repo || ""),
    pr: Number(pr),
    expectedHead: String(head || ""),
    idempotencyKey: authorityMarker.idempotencyKey,
    body: visibleBody(body),
  };
  const authority = verifyAuthorityGrant({
    token: authorityMarker.authorityGrant,
    publicKey,
    trustStore,
    request,
    now: time.now,
  });
  if (!authority.verified) {
    return {
      valid: false,
      reason: `review_authority_invalid:${authority.reason}`,
      authority,
    };
  }
  if (!authority.claims?.scopeSha256) {
    return { valid: false, reason: "review_authority_scope_hash_missing", authority };
  }
  if (authority.claims?.approvalMethod !== "windows_hello") {
    return { valid: false, reason: "review_authority_human_approval_missing", authority };
  }
  if (authority.claims?.redemption !== "required") {
    return { valid: false, reason: "review_authority_redemption_claim_missing", authority };
  }

  return {
    valid: true,
    reason: null,
    runId: verdictMarker.runId,
    head: verdictMarker.head,
    mode: authorityMarker.mode,
    idempotencyKey: authorityMarker.idempotencyKey,
    authority,
  };
}
