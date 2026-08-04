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
