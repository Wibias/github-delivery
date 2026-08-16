import { createHash } from "node:crypto";

function requiredString(value, code) {
  const text = String(value || "").trim();
  if (!text) throw new Error(code);
  return text;
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function strictRequiredChecks(snapshot = {}) {
  const rules = snapshot?.evidence?.activeRules;
  if (!Array.isArray(rules)) return false;
  return rules.some(
    (row) =>
      row?.type === "required_status_checks" &&
      row?.parameters?.strict_required_status_checks_policy === true,
  );
}

function mergeQueueEnabled(snapshot = {}) {
  return snapshot?.evidence?.policy?.mergeQueue?.enabled === true;
}

function feedbackRow(kind, row = {}) {
  const author = row?.author?.login || row?.user?.login || null;
  const updatedAt =
    row?.updatedAt ||
    row?.updated_at ||
    row?.submittedAt ||
    row?.submitted_at ||
    row?.createdAt ||
    row?.created_at ||
    null;
  return [
    kind,
    row?.id ?? row?.node_id ?? null,
    author,
    updatedAt,
    row?.state ?? null,
    row?.isResolved ?? null,
    row?.isOutdated ?? null,
    sha256(row?.body || row?.bodyText || ""),
  ];
}

function feedbackFingerprint(snapshot = {}) {
  const feedback = snapshot?.evidence?.feedback || {};
  const rows = [];
  for (const row of feedback.issueComments || []) rows.push(feedbackRow("issue_comment", row));
  for (const row of feedback.reviewComments || []) rows.push(feedbackRow("review_comment", row));
  for (const row of feedback.reviews || []) rows.push(feedbackRow("review", row));
  for (const thread of feedback.reviewThreads || []) {
    rows.push(feedbackRow("review_thread", thread));
    for (const comment of thread?.comments?.nodes || []) {
      rows.push(feedbackRow(`review_thread_comment:${thread?.id || "unknown"}`, comment));
    }
  }
  rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const pr = snapshot?.evidence?.pullRequest || {};
  return sha256(JSON.stringify({
    prUpdatedAt: pr.updatedAt || pr.updated_at || null,
    reviewDecision: pr.reviewDecision || null,
    rows,
  }));
}

export function mergeBoundaryForSnapshot(snapshot = {}) {
  const capture = snapshot?.evidence?.captureBoundary || {};
  const headOid = requiredString(snapshot?.headOid || capture.headOid, "merge_boundary_head_missing").toLowerCase();
  const baseRefName = requiredString(capture.baseRefName, "merge_boundary_base_ref_missing");
  const baseOid = requiredString(capture.baseOid, "merge_boundary_base_oid_missing").toLowerCase();
  const rulesFingerprint = requiredString(capture.rulesFingerprint, "merge_boundary_rules_fingerprint_missing").toLowerCase();
  const feedbackGeneration = feedbackFingerprint(snapshot);
  const coherence = strictRequiredChecks(snapshot)
    ? "strict_required_checks"
    : mergeQueueEnabled(snapshot)
      ? "merge_queue"
      : null;
  if (!coherence) {
    throw new Error(
      "merge_boundary_not_server_enforced: require strict required checks or merge queue before direct merge",
    );
  }
  return Object.freeze({
    headOid,
    baseRefName,
    baseOid,
    rulesFingerprint,
    feedbackFingerprint: feedbackGeneration,
    coherence,
  });
}

export function assertSameMergeBoundary(expected = {}, snapshot = {}) {
  const observed = mergeBoundaryForSnapshot(snapshot);
  for (const field of [
    "headOid",
    "baseRefName",
    "baseOid",
    "rulesFingerprint",
    "feedbackFingerprint",
    "coherence",
  ]) {
    if (observed[field] !== expected[field]) {
      throw new Error(
        `merge_boundary_moved:${field}: expected ${expected[field] || "missing"}, observed ${observed[field] || "missing"}`,
      );
    }
  }
  return observed;
}
