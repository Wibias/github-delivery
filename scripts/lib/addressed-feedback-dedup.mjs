/**
 * Publication dedup for the `[GD] Addressed feedback` comment.
 *
 * The documented rule says one cumulative addressed-feedback comment per PR,
 * keyed by the exact current head marker. In practice agents posted one new
 * comment per head, which accumulated duplicate threads over time (and legacy
 * `[shipping-github]`/`[github-delivery]` prefixed comments were never
 * migrated). This module mechanically decides whether to edit an existing
 * authored comment or post a new one, so the single-thread intent is enforced
 * instead of left to agent discipline.
 *
 * Decision model:
 * - exact current-head marker match  -> edit that comment (merge keys)
 * - any older-head or legacy addressed-feedback comment by me
 *                                     -> edit the most recent one and supersede
 *                                        its head marker to the current head
 * - none                              -> post a new comment
 */

const ADDRESSED_HEADER_RE = /^#{0,3}\s*\[(?:GD|github-delivery|shipping-github)\]\s*Addressed feedback\s*$/i;
const GD_HEADER_RE = /^#{0,3}\s*\[GD\]\s*Addressed feedback\s*$/i;
const HEAD_MARKER_RE = /^<!--\s*(?:gd|github-delivery|shipping-github):addressed-feedback\s+head:([0-9a-f]{40})\s*-->$/i;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loginOf(comment) {
  if (!isRecord(comment)) return null;
  const user = comment.user;
  return typeof user?.login === "string" ? user.login : null;
}

function bodyOf(comment) {
  if (!isRecord(comment)) return "";
  return typeof comment.body === "string" ? comment.body : "";
}

function idOf(comment) {
  if (!isRecord(comment)) return null;
  return comment.id ?? comment.node_id ?? null;
}

function createdAtOf(comment) {
  if (!isRecord(comment)) return null;
  return comment.created_at ?? comment.createdAt ?? null;
}

function isAddressedFeedbackComment(comment) {
  const lines = bodyOf(comment)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && ADDRESSED_HEADER_RE.test(lines[0]);
}

function headMarkerOf(comment) {
  const lines = bodyOf(comment).split(/\r?\n/);
  for (const line of lines) {
    const match = HEAD_MARKER_RE.exec(line.trim());
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Decide how to publish an addressed-feedback comment for `headOid`.
 *
 * @param {object} options
 * @param {Array<object>} [options.comments] PR conversation comments (issueComments rows)
 * @param {string} [options.myLogin] viewer login (the agent account)
 * @param {string} [options.headOid] current PR head SHA (40 hex)
 * @returns {{ action: "edit" | "post", commentId: number | null, reason: string, matchedHead: boolean, supersededHead: string | null, legacy: boolean }}
 */
export function planAddressedFeedbackPublication({
  comments = [],
  myLogin = null,
  headOid = null,
} = {}) {
  const normalizedHead = headOid ? String(headOid).toLowerCase() : null;
  const mine = comments.filter(
    (comment) => isAddressedFeedbackComment(comment) && loginOf(comment) === myLogin,
  );
  if (!mine.length) {
    return { action: "post", commentId: null, reason: "no_existing_addressed_comment", matchedHead: false, supersededHead: null, legacy: false };
  }

  // Exact current-head marker wins: edit that comment, merge keys into it.
  const exact = mine.find(
    (comment) => normalizedHead && headMarkerOf(comment) === normalizedHead,
  );
  if (exact) {
    return {
      action: "edit",
      commentId: idOf(exact),
      reason: "exact_head_marker_exists",
      matchedHead: true,
      supersededHead: null,
      legacy: false,
    };
  }

  // No exact marker: edit the most recent authored addressed-feedback comment
  // (any head, including legacy prefix) and supersede its head marker. This
  // keeps one cumulative thread per PR instead of one per head.
  const sorted = [...mine].sort((a, b) => {
    const ta = Date.parse(createdAtOf(a) || "");
    const tb = Date.parse(createdAtOf(b) || "");
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    return 0;
  });
  const latest = sorted[0];
  const priorHead = headMarkerOf(latest);
  const header = bodyOf(latest).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
  const legacy = ADDRESSED_HEADER_RE.test(header) && !GD_HEADER_RE.test(header);
  return {
    action: "edit",
    commentId: idOf(latest),
    reason: priorHead ? "older_head_marker_exists" : "legacy_or_unmarked_comment_exists",
    matchedHead: false,
    supersededHead: priorHead,
    legacy,
  };
}
