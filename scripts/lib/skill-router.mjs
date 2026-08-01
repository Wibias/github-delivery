function normalized(prompt) {
  return String(prompt || "").trim().toLowerCase();
}

function result(workflow, mutationMode = "read-only", explicitActions = []) {
  return {
    skill: "shipping-github",
    workflow,
    mutationMode,
    explicitActions,
  };
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

  if (
    /\b(merge|ship)\b[\s\S]*\bpr\s*#?\d+/.test(text) ||
    /^merge it\b/.test(text)
  ) {
    return result("references/merge-pr.md", "maintainer", [
      "merge_pr",
      "post_comment",
      "post_issue_comment",
      "close_linked_issue",
    ]);
  }

  if (/\b(full review|review .* for real bugs|usefulness verdict)\b/.test(text)) {
    return result(
      "references/full-review-pr.md",
      /\bfix\b/.test(text) ? "maintainer" : "review",
    );
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
    /\b(fix|address)\b[\s\S]*(review|coderabbit|codex|comment|feedback)/.test(
      text,
    ) ||
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
