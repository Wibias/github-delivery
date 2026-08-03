const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const BOT_RE = /\[bot\]$/i;
const LEGACY_AGENT_PREFIXES = [
  ["github", "delivery"].join("-"),
  ["shipping", "github"].join("-"),
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const AGENT_PREFIX_PATTERN = ["GD", ...LEGACY_AGENT_PREFIXES]
  .map(escapeRegex)
  .join("|");
const MARKER_NAMESPACE_PATTERN = ["gd", ...LEGACY_AGENT_PREFIXES]
  .map(escapeRegex)
  .join("|");
const AGENT_PREFIX_RE = new RegExp(
  `^#{0,3}\\s*\\[(?:${AGENT_PREFIX_PATTERN})\\]`,
  "i",
);
const RESOLUTION_HEADER_RE = new RegExp(
  `^#{0,3}\\s*\\[(?:${AGENT_PREFIX_PATTERN})\\]\\s*Addressed feedback\\s*$`,
  "i",
);
const RESOLUTION_MARKER_RE = new RegExp(
  `^<!--\\s*(?:${MARKER_NAMESPACE_PATTERN}):addressed-feedback\\s+head:([0-9a-f]{40})\\s*-->$`,
  "i",
);
const MERGE_COMMIT_RE =
  /^(Merge (branch|remote-tracking|pull request)|merge .* into |chore:\s*merge\b)/i;
const FEEDBACK_KEY_RE =
  /^(issue_comment|review_comment|review_submission):[A-Za-z0-9_-]+$/;
const COMMIT_REF_RE = /^[0-9a-f]{7,40}$/i;

export function normalizeFeedback(raw, kind) {
  return {
    key: `${kind}:${raw?.id ?? raw?.node_id ?? "unknown"}`,
    id: raw?.id ?? null,
    kind,
    url: raw?.html_url || raw?.url || null,
    login: raw?.user?.login || raw?.author?.login || null,
    association: raw?.author_association || raw?.authorAssociation || null,
    createdAt: raw?.created_at || raw?.submitted_at || raw?.createdAt || null,
    body: raw?.body || "",
    path: raw?.path || null,
    line: raw?.line || raw?.original_line || null,
  };
}

export function isTrustedHumanFeedback(comment, { myLogin = null } = {}) {
  if (!TRUSTED.has(comment?.association)) return false;
  if (
    !comment?.login ||
    BOT_RE.test(comment.login) ||
    comment.login === "github-actions"
  ) {
    return false;
  }
  if (myLogin && comment.login === myLogin) return false;
  const body = String(comment.body || "").trim();
  if (!body) return false;
  if (AGENT_PREFIX_RE.test(body)) return false;
  return true;
}

export function parseFeedbackResolution(comment) {
  const lines = String(comment?.body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || !RESOLUTION_HEADER_RE.test(lines[0])) return null;

  const feedbackKeys = [];
  let commitRef = null;
  let headRef = null;
  let inFeedbackList = false;
  const errors = [];

  function addFeedbackKey(value) {
    if (!FEEDBACK_KEY_RE.test(value)) {
      errors.push("invalid_feedback");
      return;
    }
    if (feedbackKeys.includes(value)) {
      errors.push("duplicate_feedback");
      return;
    }
    feedbackKeys.push(value);
  }

  for (const line of lines.slice(1)) {
    const marker = RESOLUTION_MARKER_RE.exec(line);
    if (marker) {
      if (headRef !== null) errors.push("duplicate_head_marker");
      headRef = marker[1].toLowerCase();
      inFeedbackList = false;
      continue;
    }
    if (/^<!--.*addressed-feedback/i.test(line)) {
      errors.push("invalid_head_marker");
      inFeedbackList = false;
      continue;
    }
    if (/^feedbacks:\s*$/i.test(line)) {
      inFeedbackList = true;
      continue;
    }
    if (inFeedbackList && /^-\s+/.test(line)) {
      addFeedbackKey(line.replace(/^-\s+/, "").trim());
      continue;
    }
    inFeedbackList = false;

    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "feedback") addFeedbackKey(value);
    if (name === "commit") {
      if (commitRef !== null) errors.push("duplicate_commit");
      commitRef = value;
    }
  }

  if (!feedbackKeys.length) errors.push("invalid_feedback");
  if (!commitRef || !COMMIT_REF_RE.test(commitRef)) {
    errors.push("invalid_commit");
  }

  return {
    recordKey: comment?.key || null,
    recordId: comment?.id || null,
    login: comment?.login || null,
    createdAt: comment?.createdAt || null,
    url: comment?.url || null,
    feedbackKey: feedbackKeys.length === 1 ? feedbackKeys[0] : null,
    feedbackKeys,
    commitRef,
    headRef,
    syntaxValid: errors.length === 0,
    errors: [...new Set(errors)],
  };
}

function diagnostic(record, code, extra = {}) {
  return {
    recordKey: record?.recordKey || null,
    code,
    feedbackKey: extra.feedbackKey || record?.feedbackKey || null,
    commitRef: record?.commitRef || null,
    ...extra,
  };
}

function commitTimestamp(commit) {
  return Date.parse(commit?.authoredDate || commit?.committedDate || "");
}

export function evaluateFeedbackResolutions({
  feedback = [],
  commits = [],
  myLogin = null,
  headOid = null,
} = {}) {
  const actionableFeedback = feedback.filter((comment) =>
    isTrustedHumanFeedback(comment, { myLogin }),
  );
  const actionableByKey = new Map(
    actionableFeedback.map((comment) => [comment.key, comment]),
  );
  const records = feedback.map(parseFeedbackResolution).filter(Boolean);
  const diagnostics = [];
  const validRecords = [];
  const addressed = new Set();

  for (const record of records) {
    if (!record.syntaxValid) {
      diagnostics.push(
        diagnostic(record, "malformed_resolution_record", {
          errors: record.errors,
        }),
      );
      continue;
    }
    if (!myLogin || record.login !== myLogin) {
      diagnostics.push(diagnostic(record, "resolution_author_mismatch"));
      continue;
    }
    if (
      record.headRef &&
      headOid &&
      record.headRef.toLowerCase() !== String(headOid).toLowerCase()
    ) {
      diagnostics.push(
        diagnostic(record, "resolution_head_mismatch", {
          recordHead: record.headRef,
          currentHead: headOid,
        }),
      );
      continue;
    }

    const normalizedRef = record.commitRef.toLowerCase();
    const matches = commits.filter((commit) =>
      String(commit?.oid || "").toLowerCase().startsWith(normalizedRef),
    );
    if (!matches.length) {
      diagnostics.push(diagnostic(record, "commit_not_found"));
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push(
        diagnostic(record, "commit_ambiguous", { matchCount: matches.length }),
      );
      continue;
    }

    const commit = matches[0];
    const message = String(commit?.message || "").trim();
    if (!message || MERGE_COMMIT_RE.test(message)) {
      diagnostics.push(diagnostic(record, "commit_is_merge"));
      continue;
    }

    const fixedTime = commitTimestamp(commit);
    const recordTime = Date.parse(record.createdAt || "");
    if (!Number.isFinite(fixedTime) || !Number.isFinite(recordTime)) {
      diagnostics.push(diagnostic(record, "timestamp_invalid"));
      continue;
    }
    if (recordTime < fixedTime) {
      diagnostics.push(diagnostic(record, "resolution_before_commit"));
      continue;
    }

    const resolvedFeedbackKeys = [];
    for (const feedbackKey of record.feedbackKeys) {
      const target = actionableByKey.get(feedbackKey);
      if (!target) {
        diagnostics.push(
          diagnostic(record, "feedback_not_found", { feedbackKey }),
        );
        continue;
      }
      const feedbackTime = Date.parse(target.createdAt || "");
      if (!Number.isFinite(feedbackTime)) {
        diagnostics.push(
          diagnostic(recor, "timestamp_invalid", { feedbackKey }),
        );
        continue;
      }
      if (fixedTime <= feedbackTime) {
        diagnostics.push(
          diagnostic(record, "commit_not_after_feedback", { feedbackKey }),
       );
        continue;
      }
      addressed.add(target.key);
      resolvedFeedbackKeys.push(target.key);
    }

    if (resolvedFeedbackKeys.length) {
      const sortedKeys = [...resolvedFeedbackKeys].sort();
      validRecords.push({
        ...record,
        resolvedFeedbackKeys: sortedKeys,
        resolvedCommitOid: commit.oid,
        commitCreatedAt: commit.authoredDate || commit.committedDate || null,
        feedbackCreatedAt:
          sortedKeys.length === 1
            ? actionableByKey.get(sortedKeys[0])?.createdAt || null
            : null,
      });
    }
  }

  return {
    actionableFeedback,
    records,
    validRecords,
    diagnostics,
    addressedKeys: [...addressed].sort(),
    unaddressed: actionableFeedback.filter(
      (comment) => !addressed.has(comment.key),
    ),
  };
}

export function findUnaddressedFeedback(options = {}) {
  return evaluateFeedbackResolutions(options).unaddressed;
}
