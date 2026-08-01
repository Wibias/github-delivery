const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const BOT_RE = /\[bot\]$/i;
const AGENT_PREFIX_RE = /^#{0,3}\s*\[shipping-github\]/i;
const RESOLUTION_HEADER_RE =
  /^#{0,3}\s*\[shipping-github\]\s*Addressed feedback\s*$/i;
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

  let feedbackKey = null;
  let commitRef = null;
  const errors = [];
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "feedback") {
      if (feedbackKey !== null) errors.push("duplicate_feedback");
      feedbackKey = value;
    }
    if (name === "commit") {
      if (commitRef !== null) errors.push("duplicate_commit");
      commitRef = value;
    }
  }
  if (!feedbackKey || !FEEDBACK_KEY_RE.test(feedbackKey)) {
    errors.push("invalid_feedback");
  }
  if (!commitRef || !COMMIT_REF_RE.test(commitRef)) {
    errors.push("invalid_commit");
  }

  return {
    recordKey: comment?.key || null,
    recordId: comment?.id || null,
    login: comment?.login || null,
    createdAt: comment?.createdAt || null,
    url: comment?.url || null,
    feedbackKey,
    commitRef,
    syntaxValid: errors.length === 0,
    errors: [...new Set(errors)],
  };
}

function diagnostic(record, code, extra = {}) {
  return {
    recordKey: record?.recordKey || null,
    code,
    feedbackKey: record?.feedbackKey || null,
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

    const target = actionableByKey.get(record.feedbackKey);
    if (!target) {
      diagnostics.push(diagnostic(record, "feedback_not_found"));
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

    const feedbackTime = Date.parse(target.createdAt || "");
    const fixedTime = commitTimestamp(commit);
    const recordTime = Date.parse(record.createdAt || "");
    if (
      !Number.isFinite(feedbackTime) ||
      !Number.isFinite(fixedTime) ||
      !Number.isFinite(recordTime)
    ) {
      diagnostics.push(diagnostic(record, "timestamp_invalid"));
      continue;
    }
    if (fixedTime <= feedbackTime) {
      diagnostics.push(diagnostic(record, "commit_not_after_feedback"));
      continue;
    }
    if (recordTime < fixedTime) {
      diagnostics.push(diagnostic(record, "resolution_before_commit"));
      continue;
    }

    addressed.add(target.key);
    validRecords.push({
      ...record,
      resolvedCommitOid: commit.oid,
      feedbackCreatedAt: target.createdAt,
      commitCreatedAt:
        commit.authoredDate || commit.committedDate || null,
    });
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
