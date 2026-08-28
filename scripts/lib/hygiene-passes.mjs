const COMPOSED = new Set([
  "references/full-review-pr.md",
  "references/re-review-pr.md",
  "references/fix-pr-bots.md",
  "references/create-pr-for-issue.md",
  "references/create-pr-from-local-work.md",
  "references/prepare-and-merge-pr.md",
]);

const SKIP_SIMPLIFY = /\b(?:without|skip|don't|dont|do not)\s+simplify\b/;
const SKIP_NO_COMMENTS = /\b(?:skip|without)\s+no-comments\b|\bkeep source comments\b|\bdon'?t strip comments\b|\bdo not strip comments\b/;

function normalizeWorkflow(value) {
  let workflow = String(value || "").trim().replaceAll("\\", "/");
  if (workflow && !workflow.startsWith("references/")) workflow = `references/${workflow}`;
  if (workflow && !workflow.endsWith(".md")) workflow += ".md";
  return workflow;
}

function normalized(prompt) {
  return String(prompt || "").trim().toLowerCase();
}

export function composedHygienePasses(prompt, workflow) {
  const text = normalized(prompt);
  const path = normalizeWorkflow(workflow);
  const skipSimplifyMatch = text.match(SKIP_SIMPLIFY);
  const skipNoCommentsMatch = text.match(SKIP_NO_COMMENTS);
  const skipSimplifyReason = skipSimplifyMatch?.[0] ?? null;
  const skipNoCommentsReason = skipNoCommentsMatch?.[0] ?? null;

  if (path === "references/no-comments.md") {
    return {
      noComments: "run",
      simplify: "n/a",
      skipNoCommentsReason: null,
      skipSimplifyReason: null,
    };
  }
  if (path === "references/simplify-pr.md") {
    return {
      noComments: "n/a",
      simplify: "run",
      skipNoCommentsReason: null,
      skipSimplifyReason: null,
    };
  }
  if (!COMPOSED.has(path)) {
    return {
      noComments: "n/a",
      simplify: "n/a",
      skipNoCommentsReason: null,
      skipSimplifyReason: null,
    };
  }
  return {
    noComments: skipNoCommentsReason ? "skip" : "run",
    simplify: skipSimplifyReason ? "skip" : "run",
    skipNoCommentsReason,
    skipSimplifyReason,
  };
}
