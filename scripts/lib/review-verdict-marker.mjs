const FULL_REVIEW_MARKER_RE =
  /<!--\s*github-delivery:full-review-verdict\s+run:([^\s]+)\s+head:([^\s]+)\s*-->/i;
const REVIEW_VERDICT_HEADING_RE =
  /^##\s+\[GD\]\s+Verdict:\s*(approve-comment|changes-requested|not-useful|gated)\b/im;
const REVIEW_AUTHORITY_MARKER_RE =
  /\n\n<!-- github-delivery:review-authority mode:(read-only|review|maintainer|autonomous) key:([A-Za-z0-9_-]+) grant:(gd1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+) -->/i;

function requiredString(value, code) {
  const text = String(value ?? "");
  if (!text) throw new Error(code);
  return text;
}

function encodeKey(value) {
  return Buffer.from(requiredString(value, "review_authority_idempotency_key_required"), "utf8").toString(
    "base64url",
  );
}

function decodeKey(value) {
  try {
    const decoded = Buffer.from(String(value || ""), "base64url").toString("utf8");
    if (!decoded) throw new Error("empty");
    return decoded;
  } catch {
    throw new Error("review_authority_idempotency_key_invalid");
  }
}

export function parseFullReviewMarker(body) {
  const match = String(body || "").match(FULL_REVIEW_MARKER_RE);
  return match ? { runId: match[1], head: match[2] } : null;
}

export function isFullReviewVerdictBody(body) {
  const text = String(body || "");
  return REVIEW_VERDICT_HEADING_RE.test(text) && FULL_REVIEW_MARKER_RE.test(text);
}

export function stripReviewAuthorityMarker(body) {
  return String(body ?? "").replace(REVIEW_AUTHORITY_MARKER_RE, "");
}

export function parseReviewAuthorityMarker(body) {
  const match = String(body || "").match(REVIEW_AUTHORITY_MARKER_RE);
  if (!match) return null;
  return {
    mode: match[1].toLowerCase(),
    idempotencyKey: decodeKey(match[2]),
    authorityGrant: match[3],
  };
}

export function stampReviewVerdictRequest(request = {}) {
  if (request.action !== "post_comment" || !isFullReviewVerdictBody(request.body)) {
    return structuredClone(request);
  }
  const authorityGrant = requiredString(
    request.authorityGrant,
    "review_authority_grant_required",
  );
  if (!authorityGrant.startsWith("gd1.")) {
    throw new Error("review_authority_grant_invalid");
  }
  const mode = String(request.mutationMode || "read-only").toLowerCase();
  if (!["review", "maintainer", "autonomous"].includes(mode)) {
    throw new Error("review_authority_mode_invalid");
  }
  const key = encodeKey(request.idempotencyKey);
  const visible = stripReviewAuthorityMarker(request.body).trimEnd();
  return {
    ...structuredClone(request),
    body: `${visible}\n\n<!-- github-delivery:review-authority mode:${mode} key:${key} grant:${authorityGrant} -->`,
  };
}

export function stampAuthorizedReviewVerdicts(batch = {}) {
  if (!batch || !Array.isArray(batch.requests)) {
    throw new Error("review_authority_batch_requests_required");
  }
  return {
    ...structuredClone(batch),
    requests: batch.requests.map((request) => stampReviewVerdictRequest(request)),
  };
}
