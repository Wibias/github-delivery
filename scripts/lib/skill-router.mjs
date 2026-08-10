function normalized(prompt) {
  return String(prompt || "").trim().toLowerCase();
}

function result(workflow, mutationMode = "read-only", explicitActions = []) {
  return { skill: "github-delivery", workflow, mutationMode, explicitActions };
}

const SIMPLIFY_REQUEST = /\b(simplify|simplification|cleanup|clean up|deduplicate|dedupe|reduce duplication)\b/;
const MERGE_INTENT = /\b(merge|ship)\b/;
const MERGE_READY_PHRASE = /\bmerge[- ]?ready\b/g;
const NEGATED_MERGE_INTENT = /\b(?:do not|don't|dont|never|without)\s+(?:merge|merging|ship|shipping)\b/;
const DELIBERATIVE_MERGE = /\b(?:should|can|could|would)\s+(?:i|we)\b[\s\S]*\b(?:merge|ship)\b|\b(?:why can't|why can’t|when should)\s+(?:i|we)\b[\s\S]*\b(?:merge|ship)\b|\b(?:what happens if|what if)\b[\s\S]*\b(?:merge|ship)\b|\bbefore\s+(?:i|we)\s+(?:merge|ship)\b/;
const DEFERRED_MERGE_AUTHORITY = /\b(?:merge|ship)\b[\s\S]*\b(?:only\s+)?(?:after|when|if)\s+(?:i|we)\s+(?:later\s+)?(?:confirm|approve|say\s+so|give\s+(?:you\s+)?(?:the\s+)?go-ahead)\b|\b(?:merge|ship)\b[\s\S]*\bafter\s+(?:asking|checking\s+with)\s+me\b|\b(?:ask|check\s+with)\s+me\s+(?:again\s+)?before\s+(?:you\s+)?(?:merge|ship)\b|\b(?:wait|hold)\s+(?:for\s+)?my\s+(?:confirmation|approval)\b/;
const ASSISTANT_MERGE_REQUEST = /^(?:please\s+)?(?:merge|ship)\b|\b(?:and|then)\s+(?:please\s+)?(?:merge|ship)\b|\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:merge|ship)\b|\b(?:i want|i need|i'd like|i would like)\s+you\s+to\s+(?:merge|ship)\b|\bgo ahead(?:\s+and)?\s+(?:merge|ship)\b/;
const PR_REFERENCE = /\b(?:pr|pull request)\s*#?\d+\b/;
const PR_WORD = /\b(?:pr|pull request)\b/;
const FULL_REVIEW_REQUEST = /\b(full review|review .* for real bugs|usefulness verdict)\b/;
const REVIEW_PREPARATION_REQUEST = /\b(review|re-review|review again|look over|look through)\b/;
const FIX_REVIEW_REQUEST = /\b(fix|address)\b[\s\S]*(review|coderabbit|codex|comment|feedback)/;
const ISSUE_CREATE_REQUEST = /\b(?:create|file)\b[\s\S]{0,120}\b(?:issue|issues|ticket|tickets|bug report|bug reports)\b|\bopen\s+(?:a|an|new)\b[\s\S]{0,80}\b(?:issue|ticket|bug report)\b/;
const FOLLOW_UP_ISSUE_REQUEST = /\bfollow[- ]?up\s+(?:issue|ticket)\b/;
const CREATE_PR_FOR_ISSUE_REQUEST = /\b(?:create|open)\b[\s\S]*\b(?:pr|pull request)\b[\s\S]*\b(?:issue|#\d+)\b/;
const CREATE_PR_REQUEST = /\b(?:create|open|make)\b[\s\S]{0,120}\b(?:pr|pull request)\b/;
const DELIVERY_NAME = /\bgithub[- ]?delivery\b/;
const DELIVERY_UPDATE = /\b(update|upgrade)\b[\s\S]*\bgithub[- ]?delivery\b|\bgithub[- ]?delivery\b[\s\S]*\b(update|upgrade|latest stable release)\b/;
const DELIVERY_CONFIG = /\b(set ?up|install|configure|configuration|settings?|protection mode|windows hello)\b[\s\S]*\bgithub[- ]?delivery\b|\bgithub[- ]?delivery\b[\s\S]*\b(set ?up|install|configure|configuration|settings?|protection mode|windows hello)\b/;

function prepareAndMergeActions(text) {
  const actions = ["merge_pr", "post_comment", "post_issue_comment", "close_linked_issue"];
  if (FIX_REVIEW_REQUEST.test(text) || SIMPLIFY_REQUEST.test(text)) actions.unshift("push_code");
  return actions;
}

function unquotedText(text) { return text.replace(/"[^"\n]*"|`[^`\n]*`|'[^'\n]*'/g, " "); }
function mergeText(text) { return unquotedText(text).replace(MERGE_READY_PHRASE, ""); }

export function hasExplicitMergeIntent(prompt) {
  const text = normalized(prompt);
  const candidate = mergeText(text);
  if (!MERGE_INTENT.test(candidate)) return false;
  if (NEGATED_MERGE_INTENT.test(candidate)) return false;
  if (DELIBERATIVE_MERGE.test(candidate)) return false;
  if (DEFERRED_MERGE_AUTHORITY.test(candidate)) return false;
  return ASSISTANT_MERGE_REQUEST.test(candidate);
}

export function issueCreationActionForPrompt(prompt) {
  const text = normalized(prompt);
  if (!text || CREATE_PR_FOR_ISSUE_REQUEST.test(text) || !ISSUE_CREATE_REQUEST.test(text)) return null;
  return FOLLOW_UP_ISSUE_REQUEST.test(text) ? "create_follow_up_issue" : "create_issue";
}

function isPrepareAndMergeRequest(text) {
  if (!hasExplicitMergeIntent(text) || !PR_REFERENCE.test(text)) return false;
  return FULL_REVIEW_REQUEST.test(text) || REVIEW_PREPARATION_REQUEST.test(text) || FIX_REVIEW_REQUEST.test(text) || SIMPLIFY_REQUEST.test(text);
}

function isMergeDiscussion(text) {
  return PR_REFERENCE.test(text) && MERGE_INTENT.test(text.replace(MERGE_READY_PHRASE, "")) && !hasExplicitMergeIntent(text);
}

export function routeShippingGithubPrompt(prompt) {
  const text = normalized(prompt);
  if (!text) return null;

  if (/(local|before .*pull request|before .*\bpr\b)/.test(text) && /(unit test|vitest|merge conflict|debug)/.test(text)) return null;
  if (/create .*agent skill|skill-ratchet|pdf table extraction/.test(text)) return null;

  if (DELIVERY_NAME.test(text) && DELIVERY_UPDATE.test(text)) {
    return result("references/update.md", "read-only", []);
  }
  if (DELIVERY_NAME.test(text) && DELIVERY_CONFIG.test(text)) {
    return result("references/configuration.md", "read-only", []);
  }

  if (isPrepareAndMergeRequest(text)) return result("references/prepare-and-merge-pr.md", "maintainer", prepareAndMergeActions(text));
  if ((hasExplicitMergeIntent(text) && PR_REFERENCE.test(text)) || /^merge it\b/.test(text) || /^ship it\b/.test(text)) {
    return result("references/merge-pr.md", "maintainer", ["merge_pr", "post_comment", "post_issue_comment", "close_linked_issue"]);
  }
  if (isMergeDiscussion(text)) return result("references/status.md", "read-only", []);

  if (/\b(supersede|supersedes|replace|replaces|in favor of|in favour of)\b[\s\S]*\b(?:pr|pull request)\b/.test(text)) {
    return result("references/supersede-pr.md", "maintainer", ["close_pr", "post_comment"]);
  }
  if (/\b(overtake|take over|maintainer overtake|take it over)\b[\s\S]*\b(?:pr|pull request)\b/.test(text)) {
    return result("references/overtake-pr.md", "maintainer", ["push_code", "post_comment", "close_pr"]);
  }
  if (FULL_REVIEW_REQUEST.test(text)) {
    const simplifyRequested = SIMPLIFY_REQUEST.test(text);
    return result("references/full-review-pr.md", /\bfix\b/.test(text) || simplifyRequested ? "maintainer" : "review", simplifyRequested ? ["push_code"] : []);
  }
  if (SIMPLIFY_REQUEST.test(text) && PR_REFERENCE.test(text)) return result("references/simplify-pr.md", "maintainer", ["push_code"]);
  if (/\b(?:security review|review security)\b/.test(text)) return result("references/security-review.md", "review");
  if (/\b(re-review|review again|recheck .*review)\b/.test(text)) return result("references/re-review-pr.md", "review");
  if (/\b(watch|monitor|babysit|keep an eye on)\b[\s\S]*\b(?:pr|pull request)\b/.test(text)) {
    const autonomous = /\bautonomous(ly)?\b|\bauto[- ]?fix\b|\bfix and merge without asking\b/.test(text);
    return result("references/watch-pr.md", autonomous ? "autonomous" : "read-only");
  }
  if (CREATE_PR_FOR_ISSUE_REQUEST.test(text)) return result("references/create-pr-for-issue.md", "maintainer");
  if (CREATE_PR_REQUEST.test(text) && !PR_REFERENCE.test(text)) return result("references/create-pr-from-local-work.md", "maintainer", ["push_code", "create_pr"]);
  if (/\b(research|investigate)\b[\s\S]*\b(issue|issues|#\d+)\b/.test(text)) return result("references/research-issue.md", "review");

  const issueCreationAction = issueCreationActionForPrompt(text);
  if (issueCreationAction) return result("references/issue-workflows.md", "maintainer", [issueCreationAction]);

  if (FIX_REVIEW_REQUEST.test(text) || /\bmake\b[\s\S]*\b(?:pr|pull request)\b[\s\S]*\bmerge[- ]?ready\b/.test(text)) {
    return result("references/fix-pr-bots.md", "maintainer", ["push_code"]);
  }
  if (/\b(what(?:'s| is) left|status|merge[- ]?ready\?|is .* ready)\b/.test(text) && PR_WORD.test(text)) return result("references/status.md", "read-only");
  return null;
}
