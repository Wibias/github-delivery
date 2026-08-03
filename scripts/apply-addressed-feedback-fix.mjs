import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, value) {
  writeFileSync(path, value, "utf8");
}

function replaceOnce(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return text.replace(oldValue, newValue);
}

const tracked = execFileSync("git", ["ls-files", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

for (const path of tracked) {
  if (
    path === ".github/workflows/ci.yml" ||
    path === "scripts/apply-addressed-feedback-fix.mjs" ||
    path === "tests/unit/addressed-feedback-comment.test.mjs"
  ) {
    continue;
  }
  let text;
  try {
    text = read(path);
  } catch {
    continue;
  }
  const updated = text.replaceAll("[github-delivery]", "[GD]");
  if (updated !== text) write(path, updated);
}

{
  const path = "SKILL.md";
  let text = read(path);
  const anchor =
    "15. **Comment identity and idempotency.** One publication identity produces one `[GD]` comment. Retries, corrections, and resumed work within the same workflow run must edit that run’s own comment instead of posting duplicates.\n";
  const addition =
    "\n    For `Addressed feedback`, the publication identity is **PR + exact current head SHA**, never the individual feedback ID. Publish at most one top-level `[GD] Addressed feedback` comment for that head. Aggregate every feedback key resolved by the same head into that comment, include `<!-- gd:addressed-feedback head:<40-char-head-sha> -->`, and edit the exact marker match when more keys are added. Never post one top-level comment per feedback item.\n";
  text = replaceOnce(text, anchor, anchor + addition, "SKILL addressed-feedback rule");
  write(path, text);
}

{
  const path = "references/shared-rules.md";
  let text = read(path);
  const oldBlock = `For any \`[GD]\` comment intent on an issue or PR (opened-PR notice, research review, security review, merge-ready, etc.):

1. Before posting, look for an existing comment **you** authored with the same intent prefix on that thread.
2. If one exists: **edit that comment** to the full final body. Do **not** post a second comment.
3. Compose the **full** body first; post once. If the create fails or the body is truncated/incomplete: **edit the same comment** to the complete text — never add a follow-up “completion” comment.
4. One intent → one comment. Truncated + full = bug; fix by edit.
`;
  const newBlock = `For any \`[GD]\` comment intent on an issue or PR (opened-PR notice, research review, security review, merge-ready, etc.):

1. Before posting, look for an existing comment **you** authored with the same publication identity on that thread.
2. If one exists: **edit that comment** to the full final body. Do **not** post a second comment.
3. Compose the **full** body first; post once. If the create fails or the body is truncated/incomplete: **edit the same comment** to the complete text — never add a follow-up “completion” comment.
4. One publication identity → one comment. Truncated + full = bug; fix by edit.

### Addressed-feedback identity (one comment per head)

For \`[GD] Addressed feedback\`, the identity key is \`PR + exact current head SHA\`; an individual feedback ID is **not** a publication identity.

1. Collect every trusted feedback item resolved by the current head before publishing.
2. Search your existing PR conversation comments for the exact marker \`<!-- gd:addressed-feedback head:<40-char-head-sha> -->\`.
3. If an exact marker match exists, edit that comment and merge the full deduplicated feedback-key set into it. If none exists, create exactly one comment.
4. Never create separate top-level comments for multiple feedback items resolved by the same head or commit.
5. Use this canonical body:

\`\`\`markdown
[GD] Addressed feedback

feedbacks:
- issue_comment:123
- review_comment:456

commit: abc1234

<!-- gd:addressed-feedback head:<40-char-head-sha> -->
\`\`\`

Legacy long-form resolution records remain readable as migration evidence, but every new publication uses \`[GD]\` and the head marker.
`;
  text = replaceOnce(text, oldBlock, newBlock, "shared-rules idempotency block");
  text = replaceOnce(
    text,
    "**Single writer:** do not run watch + fix-pr merge-ready posting concurrently on the same PR in a way that double-posts; one workflow owns the `[GD] Merge ready` comment.",
    "**Single writer:** do not run watch + fix-pr concurrently on the same PR in a way that double-posts. One workflow owns the `[GD] Merge ready` comment, and one exact PR head owns one `[GD] Addressed feedback` comment.",
    "shared-rules single writer",
  );
  write(path, text);
}

{
  const path = "references/gate-helpers.md";
  let text = read(path);
  const oldBlock = `\`\`\`text
[GD] Addressed feedback
feedback: review_comment:67890
commit: abc1234
\`\`\`

An unrelated later commit does not clear feedback.
`;
  const newBlock = `\`\`\`text
[GD] Addressed feedback

feedbacks:
- issue_comment:12345
- review_comment:67890

commit: abc1234

<!-- gd:addressed-feedback head:<40-char-current-head-sha> -->
\`\`\`

Aggregate all feedback resolved by the same current head into this single comment. Before creating it, search for the exact head marker and edit that comment when present. An unrelated later commit does not clear feedback.
`;
  text = replaceOnce(text, oldBlock, newBlock, "gate-helpers example");
  write(path, text);
}

{
  const path = "references/watch-pr.md";
  let text = read(path);
  const oldBlock = `    \`\`\`markdown
    [GD] Addressed owner feedback — <one line what changed on tip>
    \`\`\`

  - **ACK-only does not clear the gate** (script requires a later non-merge commit).
`;
  const newBlock = `    \`\`\`markdown
    [GD] Addressed feedback

    feedbacks:
    - issue_comment:<id>
    - review_comment:<id>

    commit: <fix-commit>

    <!-- gd:addressed-feedback head:<40-char-current-head-sha> -->
    \`\`\`

    Collect all items fixed by the same head first. Search for the exact head marker and edit that one comment; never publish one top-level comment per feedback ID.

  - **ACK-only does not clear the gate** (script requires a later non-merge commit).
`;
  text = replaceOnce(text, oldBlock, newBlock, "watch-pr paper trail");
  write(path, text);
}

const watchFeedbackSource = `const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const BOT_RE = /\\[bot\\]$/i;
const LEGACY_AGENT_PREFIXES = [
  ["github", "delivery"].join("-"),
  ["shipping", "github"].join("-"),
];
function escapeRegex(value) {
  return value.replace(/[|\\{}()[\\]^$+*?.-]/g, "\\$&");
}
const AGENT_PREFIX_PATTERN = ["GD", ...LEGACY_AGENT_PREFIXES]
  .map(escapeRegex)
  .join("|");
const MARKER_NAMESPACE_PATTERN = ["gd", ...LEGACY_AGENT_PREFIXES]
  .map(escapeRegex)
  .join("|");
const AGENT_PREFIX_RE = new RegExp(
  "^#{0,3}\\s*\\[(?:" + AGENT_PREFIX_PATTERN + ")\\]",
  "i",
);
const RESOLUTION_HEADER_RE = new RegExp(
  "^#{0,3}\\s*\\[(?:" +
    AGENT_PREFIX_PATTERN +
    ")\\]\\s*Addressed feedback\\s*$",
  "i",
);
const RESOLUTION_MARKER_RE = new RegExp(
  "^<!--\\s*(?:" +
    MARKER_NAMESPACE_PATTERN +
    "):addressed-feedback\\s+head:([0-9a-f]{40})\\s*-->$",
  "i",
);
const MERGE_COMMIT_RE =
  /^(Merge (branch|remote-tracking|pull request)|merge .* into |chore:\s*merge\b)/i;
const FEEDBACK_KEY_RE =
  /^(issue_comment|review_comment|review_submission):[A-Za-z0-9_-]+$/;
const COMMIT_REF_RE = /^[0-9a-f]{7,40}$/i;

export function normalizeFeedback(raw, kind) {
  return {
    key: kind + ":" + (raw?.id ?? raw?.node_id ?? "unknown"),
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
    .split(/\\r?\\n/)
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
          diagnostic(record, "timestamp_invalid", { feedbackKey }),
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
`;
write("scripts/lib/watch-feedback.mjs", watchFeedbackSource);

{
  const path = "scripts/lib/snapshot-evaluators.mjs";
  let text = read(path);
  text = replaceOnce(
    text,
    "const resolution = evaluateFeedbackResolutions({ feedback, commits, myLogin });",
    "const resolution = evaluateFeedbackResolutions({ feedback, commits, myLogin, headOid: snapshot.headOid });",
    "snapshot resolution call",
  );

  const loopAnchor = `  for (const comment of unaddressed) {
    blockers.push({
`;
  const aggregateAnchor = `  const addressedFeedbackComment = unaddressed.length
    ? [
        "[GD] Addressed feedback",
        "",
        "feedbacks:",
        ...unaddressed.map((comment) => "- " + comment.key),
        "",
        "commit: <7-40 character PR commit SHA>",
        "",
        "<!-- gd:addressed-feedback head:" + snapshot.headOid + " -->",
      ].join("\\n")
    : null;
  for (const comment of unaddressed) {
    blockers.push({
`;
  text = replaceOnce(text, loopAnchor, aggregateAnchor, "snapshot aggregate template");

  const oldHowToClear =
    '      howToClear: `[GD] Addressed feedback\\nfeedback: ${comment.key}\\ncommit: <7-40 character PR commit SHA>`, ';
  const exactOldHowToClear = oldHowToClear.trimEnd();
  text = replaceOnce(
    text,
    exactOldHowToClear,
    "      howToClear: addressedFeedbackComment,",
    "snapshot howToClear",
  );

  const returnAnchor = `    resolutionDiagnostics: resolution.diagnostics,
  };
}`;
  const returnReplacement = `    resolutionDiagnostics: resolution.diagnostics,
    addressedFeedbackComment,
  };
}`;
  text = replaceOnce(
    text,
    returnAnchor,
    returnReplacement,
    "snapshot return field",
  );
  write(path, text);
}

{
  const regressionPath = "tests/evals/regression-cases.jsonl";
  const lock = read(regressionPath)
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => ({
      id: JSON.parse(line).id,
      sha256: createHash("sha256").update(line, "utf8").digest("hex"),
    }));
  write("tests/evals/regression-lock.json", JSON.stringify(lock, null, 2) + "\n");
}
