import { spawnSync } from "node:child_process";

const MARKER_ANCHOR =
  /github-delivery:full-review-verdict\s+run:([^\s]+)\s+head:([^\s]+)/;

const VERDICT_LABELS = [
  "approve-comment",
  "changes-requested",
  "not-useful",
  "gated",
];

const VERDICT_HEADING =
  /^##\s+\[GD\]\s+Verdict:\s*(approve-comment|changes-requested|not-useful|gated)\b/im;
const VERDICT_HEADING_PREFIX = /^##\s+\[GD\]\s+Verdict:/im;
const TLDR_HEADING = /^###\s+TLDR\b/im;
const DETAILS_OPEN = /<details\b/i;
const DETAILS_SUMMARY = /<summary\b/i;
const DETAILS_CLOSE = /<\/details\s*>/i;
const BULLET_KEY = /^-\s*\*\*([^*]+?):\*\*/gm;

// Keys required in the `### TLDR` block, per references/comment-depth.md.
// Matching is case-insensitive and tolerant of spacing around `/`.
const REQUIRED_TLDR_KEYS = [
  "pr",
  "head",
  "decision",
  "usefulness",
  "bugs",
  "security",
  "spec/standards",
  "reviews",
  "base/ci",
  "gate",
  "owner actions",
  "bottom line",
];

function normalizeKey(value) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .trim();
}

function normalizeComparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVerdictMarker(body) {
  const text = typeof body === "string" ? body : "";
  const match = text.match(MARKER_ANCHOR);
  if (!match) return null;
  return { runId: match[1], head: match[2] };
}

export function extractVerdictLabel(body) {
  const text = typeof body === "string" ? body : "";
  const match = text.match(VERDICT_HEADING);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Extract TLDR bullet values keyed by normalized key names.
 * Returns an empty object when the TLDR heading is absent.
 */
export function extractTldrBullets(body) {
  const text = typeof body === "string" ? body : "";
  const tldrMatch = text.match(TLDR_HEADING);
  if (!tldrMatch) return {};
  const sectionEnd = text.slice(tldrMatch.index).search(/\n#{2,3}\s/);
  const section =
    sectionEnd === -1
      ? text.slice(tldrMatch.index)
      : text.slice(tldrMatch.index, tldrMatch.index + sectionEnd);
  const bullets = {};
  for (const match of section.matchAll(BULLET_KEY)) {
    const key = normalizeKey(match[1]);
    const lineStart = match.index;
    const lineEnd = section.indexOf("\n", lineStart);
    const line =
      lineEnd === -1 ? section.slice(lineStart) : section.slice(lineStart, lineEnd);
    const value = line.replace(/^-\s*\*\*[^*]+?:\*\*\s*/, "").trim();
    bullets[key] = value;
  }
  return bullets;
}

/**
 * Compare two completed verdict bodies for material publication delta.
 * Label + required TLDR bullet values decide whether a second same-head
 * top-level comment is noise (PR #1066 double post) vs a real new review.
 */
export function materialVerdictDelta({ previousBody, nextBody }) {
  const previous = typeof previousBody === "string" ? previousBody : "";
  const next = typeof nextBody === "string" ? nextBody : "";
  const reasons = [];
  const previousLabel = extractVerdictLabel(previous);
  const nextLabel = extractVerdictLabel(next);
  if (previousLabel !== nextLabel) {
    reasons.push("verdict_label_changed");
  }
  const previousBullets = extractTldrBullets(previous);
  const nextBullets = extractTldrBullets(next);
  for (const key of REQUIRED_TLDR_KEYS) {
    const prevValue = normalizeComparableText(previousBullets[key] || "");
    const nextValue = normalizeComparableText(nextBullets[key] || "");
    if (prevValue !== nextValue) {
      reasons.push(`tldr_changed:${key}`);
    }
  }
  return {
    material: reasons.length > 0,
    reasons,
    previousLabel,
    nextLabel,
  };
}

export function listVerdictPublications({ comments = [] }) {
  const publications = [];
  for (const comment of comments) {
    const body = typeof comment?.body === "string" ? comment.body : "";
    const marker = parseVerdictMarker(body);
    if (!marker) continue;
    const format = validateVerdictFormat({ body });
    publications.push({
      comment,
      runId: marker.runId,
      head: marker.head,
      label: extractVerdictLabel(body),
      format,
      completed: format.valid === true,
    });
  }
  return publications;
}

export function findCompletedVerdictsForHead({ comments = [], head }) {
  const expectedHead = String(head || "");
  if (!expectedHead) return [];
  return listVerdictPublications({ comments }).filter(
    (entry) => entry.head === expectedHead && entry.completed,
  );
}

/**
 * Decide whether this full-review run should post, edit, or reuse.
 *
 * Same head + no material TLDR/label delta -> reuse the latest completed
 * same-head verdict (do not double-post). Same head + material change ->
 * post a new historical comment. Exact current run marker always wins for
 * repair/completion of this run.
 */
export function planVerdictPublication({
  comments = [],
  runId,
  head,
  body,
}) {
  const expectedRun = String(runId || "");
  const expectedHead = String(head || "");
  const nextBody = typeof body === "string" ? body : "";
  if (!expectedRun || !expectedHead) {
    return {
      action: "blocked",
      reason: "run_id_or_head_missing",
      targetComment: null,
      reusedFromRunId: null,
      materialDelta: null,
    };
  }
  if (!nextBody.trim()) {
    return {
      action: "blocked",
      reason: "verdict_body_empty",
      targetComment: null,
      reusedFromRunId: null,
      materialDelta: null,
    };
  }

  const current = findVerdictPublication({
    comments,
    runId: expectedRun,
    head: expectedHead,
  });
  if (current) {
    const format = validateVerdictFormat({ body: current.body });
    if (!format.valid) {
      return {
        action: "edit_current_run",
        reason: "current_run_format_invalid",
        targetComment: current,
        reusedFromRunId: null,
        materialDelta: null,
        format,
      };
    }
    const delta = materialVerdictDelta({
      previousBody: current.body,
      nextBody,
    });
    if (delta.material) {
      return {
        action: "edit_current_run",
        reason: "current_run_material_update",
        targetComment: current,
        reusedFromRunId: null,
        materialDelta: delta,
        format,
      };
    }
    return {
      action: "already_published",
      reason: "current_run_complete",
      targetComment: current,
      reusedFromRunId: null,
      materialDelta: delta,
      format,
    };
  }

  const sameHead = findCompletedVerdictsForHead({
    comments,
    head: expectedHead,
  });
  // Prefer the newest completed same-head comment (GitHub returns ascending by
  // default; take the last match for deterministic reuse).
  const latest = sameHead.length > 0 ? sameHead[sameHead.length - 1] : null;
  if (latest) {
    const delta = materialVerdictDelta({
      previousBody: latest.comment.body,
      nextBody,
    });
    if (!delta.material) {
      return {
        action: "reuse_same_head",
        reason: "same_head_no_material_delta",
        targetComment: latest.comment,
        reusedFromRunId: latest.runId,
        materialDelta: delta,
        format: latest.format,
      };
    }
    return {
      action: "post_new",
      reason: "same_head_material_delta",
      targetComment: null,
      reusedFromRunId: null,
      materialDelta: delta,
      priorComment: latest.comment,
      priorRunId: latest.runId,
    };
  }

  return {
    action: "post_new",
    reason: "no_existing_verdict",
    targetComment: null,
    reusedFromRunId: null,
    materialDelta: null,
  };
}

export function findVerdictPublication({ comments = [], runId, head }) {
  const expectedRun = String(runId || "");
  const expectedHead = String(head || "");
  if (!expectedRun || !expectedHead) return null;
  for (const comment of comments) {
    const body = typeof comment?.body === "string" ? comment.body : "";
    const match = body.match(MARKER_ANCHOR);
    if (match && match[1] === expectedRun && match[2] === expectedHead) {
      return comment;
    }
  }
  return null;
}

/**
 * Validate the public verdict structure mandated by
 * references/comment-depth.md (full-review / re-review verdict template):
 * strict `## [GD] Verdict: <label>` heading, `### TLDR` with every required
 * bullet, and the complete verdict inside a `<details>` dropdown after the
 * TLDR. Returns `{ valid, problems }` with stable problem codes.
 */
export function validateVerdictFormat({ body }) {
  const text = typeof body === "string" ? body : "";
  const problems = [];
  if (!text.trim()) {
    return { valid: false, problems: ["verdict_body_empty"] };
  }

  if (!VERDICT_HEADING.test(text)) {
    problems.push(
      VERDICT_HEADING_PREFIX.test(text)
        ? "verdict_label_invalid"
        : "verdict_heading_missing",
    );
  }

  const tldrMatch = text.match(TLDR_HEADING);
  if (!tldrMatch) {
    problems.push("tldr_heading_missing");
  } else {
    const sectionEnd = text.slice(tldrMatch.index).search(/\n#{2,3}\s/);
    const section =
      sectionEnd === -1
        ? text.slice(tldrMatch.index)
        : text.slice(tldrMatch.index, tldrMatch.index + sectionEnd);
    const present = new Set();
    for (const match of section.matchAll(BULLET_KEY)) {
      present.add(normalizeKey(match[1]));
    }
    const missing = REQUIRED_TLDR_KEYS.filter(
      (key) =>
        ![...present].some((found) => found === key || found.startsWith(key)),
    );
    if (missing.length > 0) {
      problems.push(`tldr_bullets_missing:${missing.join(",")}`);
    }
  }

  if (
    !DETAILS_OPEN.test(text) ||
    !DETAILS_SUMMARY.test(text) ||
    !DETAILS_CLOSE.test(text)
  ) {
    problems.push("details_dropdown_missing");
  }

  if (tldrMatch && DETAILS_OPEN.test(text)) {
    const detailsIndex = text.search(DETAILS_OPEN);
    if (tldrMatch.index > detailsIndex) {
      problems.push("tldr_not_before_details");
    }
  }

  return { valid: problems.length === 0, problems };
}

export { VERDICT_LABELS };

export function fetchPrConversationComments({ repo, pr }) {
  const comments = [];
  let page = 1;
  for (;;) {
    const result = spawnSync(
      "gh",
      [
        "api",
        `repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
        "--jq",
        ".",
      ],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim();
      throw new Error(detail || `gh failed (${result.status})`);
    }
    const batch = JSON.parse(result.stdout || "[]");
    comments.push(...batch);
    if (batch.length < 100) return comments;
    page += 1;
  }
}
