function normalized(prompt) {
  return String(prompt || "").trim().toLowerCase();
}

function result(workflow, mutationMode = "read-only", explicitActions = []) {
  return {
    skill: "github-delivery",
    workflow,
    mutationMode,
    explicitActions,
  };
}

const SIMPLIFY_REQUEST =
  /\b(simplify|simplification|cleanup|clean up|deduplicate|dedupe|reduce duplication)\b/;
const MERGE_INTENT = /\b(merge|ship)\b/;
const MERGE_READY_PHRASE = /\bmerge[- ]?ready\b/g;
const NEGATED_MERGE_INTENT =
  /\b(?:do not|don't|dont|never|without)\s+(?:merge|merging|ship|shipping)\b/;
const DELIBERATIVE_MERGE =
  /\b(?:should|can|could|would)\s+(?:i|we)\b[\s\S]*\b(?:merge|ship)\b|\b(?:why can't|why can’t|when should)\s+(?:i|we)\b[\s\S]*\b(?:merge|ship)\b|\b(?:what happens if|what if)\b[\s\S]*\b(?:merge|ship)\b|\bbefore\s+(?:i|we)\s+(?:merge|ship)\b/;
const ASSISTANT_MERGE_REQUEST =
  /\b(?:please\s+)?(?:merge|ship)\b|\b(?:can|could|would|will)\s+you\b[\s\S]*\b(?:merge|ship)\b|\bgo ahead(?: and)?\s+(?:merge|ship)\b/;
const PR_REFERENCE = /\bpr\s*#?\d+\b/;
const FULL_REVIEW_REQUEST = /\b(full review|review .* for real bugs|usefulness verdict)\b/;
const FIX_REVIEW_REQUEST =
  /\b(fix|address)\b[\s\S]*(review|coderabbit|codex|comment|feedback)/;

function prepareAndMergeActions(text) {
  const actions = ["merge_pr", "post_comment", "post_issue_comment", "close_linked_issue"];
  if (FIX_REVIEW_REQUEST.test(text) || SIMPLIFY_REQUEST.test(text)) {
    actions.unshift("push_code");
  }
  return actions;
}

function unquotedText(text) {
  return text.replace(/"[^"\n]*"|`[^`\n]*`|'[^'\n]*'/g, " ");
}

function mergeText(text) {
  return unquotedText(text).replace(MERGE_READY_PHRASE, "");
}

export function hasExplicitMergeIntent(prompt) {
  const text = normalized(prompt);
  const candidate = mergeText(text);
  if (!MERGE_INTENT.test(candidate)) return false;
  if (NEGATED_MERGE_INTENT.test(candidate)) return false;
  if (DELIBERATIVE_MERGE.test(candidate)) return false;
  return ASSISTANT_MERGE_REQUEST.test(candidate);
}

function isPrepareAndMergeRequest(text) {
  if (!hasExplicitMergeIntent(text) || !PR_REFERENCE.test(text)) {
    return false;
  }
  return (
    FULL_REVIEW_REQUEST.test(text) ||
    FIX_REVIEW_REQUEST.test(text) ||
    SIMPLIFY_REQUEST.test(text)
  );
}

function isMergeDiscussion(text) {
  return PR_REFERENCE.test(text) && MERGE_INTENT.test(text.replace(MERGE_READY_PHRASE, "")) && !hasExplicitMergeIntent(text);
}

export function routeShippingGithubPrompt(prompt) {
  const text = normalized(prompt);
  if (!text) return null;

  if (
    /(local|before .*pull request|before .*\bpr\b)/.test(text) &&
    /(unit test|vitest|merge conflict|debug)/.test(text)
  ) {
    return null;
  }
  if (/create .*agent skill|skill-ratchet|pdf table extraction/.test(text)) {
    return null;
  }

  if (isPrepareAndMergeRequest(text)) {
    return result(
      "references/prepare-and-merge-pr.md",
      "maintainer",
      prepareAndMergeActions(text),
    );
  }

  if (
    (hasExplicitMergeIntent(text) && PR_REFERENCE.test(text)) ||
    /^merge it\b/.test(text) ||
    /^ship it\b/.test(text)
  ) {
    return result("references/merge-pr.md", "maintainer", [
      "merge_pr",
      "post_comment",
      "post_issue_comment",
      "close_linked_issue",
    ]);
  }

  if (isMergeDiscussion(text)) {
    return result("references/status.md", "read-only", []);
  }

  if (
    /\b(supersede|supersedes|replace|replaces|in favor of|in favour of)\b[\s\S]*\bpr\b/.test(
      text,
    )
  ) {
    return result("references/supersede-pr.md", "maintainer", [
      "close_pr",
      "post_comment",
    ]);
  }

  if (
    /\b(overtake|take over|maintainer overtake|take it over)\b[\s\S]*\bpr\b/.test(
      text,
    )
  ) {
    return result("references/overtake-pr.md", "maintainer", [
      "push_code",
      "post_comment",
      "close_pr",
    ]);
  }

  if (FULL_REVIEW_REQUEST.test(text)) {
    const simplifyRequested = SIMPLIFY_REQUEST.test(text);
    return result(
      "references/full-review-pr.md",
      /\bfix\b/.test(text) || simplifyRequested ? "maintainer" : "review",
      simplifyRequested ? ["push_code"] : [],
    );
  }

  if (SIMPLIFY_REQUEST.test(text) && PR_REFERENCE.test(text)) {
    return result("references/simplify-pr.md", "maintainer", ["push_code"]);
  }

  if (/\bsecurity review\b/.test(text)) {
    return result("references/security-review.md", "review");
  }

  if (/\b(re-review|review again|recheck .*review)\b/.test(text)) {
    return result("references/re-review-pr.md", "review");
  }

  if (/\b(watch|monitor|babysit|keep an eye on)\b[\s\S]*\bpr\b/.test(text)) {
    const autonomous = /\bautonomous(ly)?\b|\bauto[- ]?fix\b|\bfix and merge without asking\b/.test(
      text,
    );
    return result(
      "references/watch-pr.md",
      autonomous ? "autonomous" : "read-only",
    );
  }

  if (
    /\b(create|open)\b[\s\S]*\bpr\b[\s\S]*\b(issue|#\d+)\b/.test(text)
  ) {
    return result("references/create-pr-for-issue.md", "maintainer");
  }

  if (/\b(research|investigate)\b[\s\S]*\b(issue|issues|#\d+)\b/.test(text)) {
    return result("references/research-issue.md", "review");
  }

  if (
    FIX_REVIEW_REQUEST.test(text) ||
    /\bmake\b[\s\S]*\bpr\b[\s\S]*\bmerge[- ]?ready\b/.test(text)
  ) {
    return result("references/fix-pr-bots.md", "maintainer", ["push_code"]);
  }

  if (
    /\b(what(?:'s| is) left|status|merge[- ]?ready\?|is .* ready)\b/.test(text) &&
    /\bpr\b/.test(text)
  ) {
    return result("references/status.md", "read-only");
  }

  return null;
}
