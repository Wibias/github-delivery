from pathlib import Path


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8", newline="\n")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# 1) Prompt-injection attribution: issue/repository text is untrusted input.
path = "scripts/lib/skill-router.mjs"
text = read(path)
old = '''const ATTRIBUTED_UNTRUSTED_SPAN =
  /\\b(?:(?:a|the)\\s+)?(?:(?:coderabbit|bot|github|reviewer|review)\\s+)?(?:comments?|pr body|pull request body|title\\/body|readme|commit messages?)\\s+(?:says|said|contains|claims?)\\s*:\\s*[\\s\\S]*?(?:\\n\\n|$)/gi;'''
new = '''const ATTRIBUTED_UNTRUSTED_SPAN =
  /\\b(?:(?:a|the)\\s+)?(?:(?:coderabbit|bot|github|reviewer|review)\\s+)?(?:comments?|pr body|pull request body|issue body|issue description|repository text|repo text|title\\/body|readme|commit messages?)\\s+(?:says|said|contains|claims?)\\s*:\\s*[\\s\\S]*?(?:\\n\\n|$)/gi;'''
text = replace_once(text, old, new, "skill-router attribution")
write(path, text)


# 2) Named GraphQL mutation operations must be visible to the mutation boundary.
path = "scripts/lib/mutation-boundary-security.mjs"
text = read(path)
text = replace_once(
    text,
    'const GRAPHQL_MUTATION_RE = /\\bmutation\\s*(?:\\([^)]*\\))?\\s*\\{/i;',
    'const GRAPHQL_MUTATION_RE = /\\bmutation(?:\\s+[A-Za-z_]\\w*)?\\s*(?:\\([^)]*\\))?\\s*\\{/i;',
    "graphql mutation detector",
)
text = replace_once(
    text,
    'const GRAPHQL_MUTATION_NAME_RE = /\\bmutation\\s*(?:\\([^)]*\\))?\\s*\\{\\s*([A-Za-z_]\\w*)/g;',
    'const GRAPHQL_MUTATION_NAME_RE = /\\bmutation(?:\\s+[A-Za-z_]\\w*)?\\s*(?:\\([^)]*\\))?\\s*\\{\\s*([A-Za-z_]\\w*)/g;',
    "graphql mutation name detector",
)
write(path, text)


# 3) Classic branch matching: support only a proven subset and fail closed otherwise.
path = "scripts/lib/snapshot-evaluators.mjs"
text = read(path)
start = text.index("function characterClassExpression")
end = text.index("\n\nfunction policyEvidence", start)
new_block = r'''function classicPatternSupported(pattern) {
  const source = String(pattern || "");
  if (!source || source.includes("\\")) return false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "[") {
      const close = source.indexOf("]", index + 1);
      if (close <= index + 1) return false;
      const body = source.slice(index + 1, close);
      if (body[0] === "^" || body.includes("\\")) return false;
      index = close;
      continue;
    }
    if (character === "*" && source[index + 1] === "*") {
      const before = index === 0 ? null : source[index - 1];
      const after = source[index + 2] ?? null;
      if ((before !== null && before !== "/") || (after !== null && after !== "/")) {
        return false;
      }
      index += 1;
    }
  }
  return true;
}

function characterClassExpression(source, segmentStart) {
  if (!source) return null;
  let value = source;
  let prefix = "";
  if (value[0] === "!") {
    prefix = "^";
    value = value.slice(1);
  }
  if (!value || value[0] === "^") return null;
  const escaped = value.replaceAll("]", "\\]");
  return `${segmentStart ? "(?!\\.)" : ""}[${prefix}${escaped}]`;
}

export function patternMatchesBranch(pattern, branch) {
  const source = String(pattern || "");
  const target = String(branch || "");
  if (!classicPatternSupported(source)) return false;
  if (source === target) return true;

  let expression = "^";
  let segmentStart = true;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "/") {
      expression += "/";
      segmentStart = true;
      continue;
    }
    if (character === "*") {
      if (source[index + 1] === "*") {
        const after = source[index + 2] ?? null;
        if (after === "/") {
          expression += "(?:(?!\\.)[^/]+/)*";
          index += 2;
          segmentStart = true;
          continue;
        }
        expression += "(?:(?!\\.)[^/]+(?:/(?!\\.)[^/]+)*)?";
        index += 1;
        segmentStart = false;
        continue;
      }
      expression += `${segmentStart ? "(?!\\.)" : ""}[^/]*`;
      segmentStart = false;
      continue;
    }
    if (character === "?") {
      expression += `${segmentStart ? "(?!\\.)" : ""}[^/]`;
      segmentStart = false;
      continue;
    }
    if (character === "[") {
      const close = source.indexOf("]", index + 1);
      const classExpression = characterClassExpression(source.slice(index + 1, close), segmentStart);
      if (!classExpression) return false;
      expression += classExpression;
      index = close;
      segmentStart = false;
      continue;
    }
    expression += escapeRegexCharacter(character);
    segmentStart = false;
  }
  expression += "$";

  try {
    return new RegExp(expression).test(target);
  } catch {
    return false;
  }
}

function unsupportedClassicPatterns(snapshot) {
  return (policyEvidence(snapshot).branchProtectionRules?.nodes || [])
    .map((rule) => String(rule?.pattern || ""))
    .filter((pattern) => pattern && !classicPatternSupported(pattern));
}
'''
text = text[:start] + new_block + text[end:]
old = '''function matchingClassicRules(snapshot) {
  const base = protectionRefName(snapshot) || pullRequest(snapshot).baseRefName;
  return (
    policyEvidence(snapshot).branchProtectionRules?.nodes || []
  ).filter((rule) => patternMatchesBranch(rule?.pattern, base));
}

function classicProtectionReadable(snapshot, matchingRules) {
  if (!sourceReadable(snapshot, "branchProtection")) return false;
  if (!matchingRules.length) return true;
  return snapshot?.evidence?.branchProtection !== null &&
    snapshot?.evidence?.branchProtection !== undefined;
}'''
new = '''function matchingClassicRules(snapshot) {
  const base = protectionRefName(snapshot) || pullRequest(snapshot).baseRefName;
  return (
    policyEvidence(snapshot).branchProtectionRules?.nodes || []
  ).filter((rule) => {
    const pattern = String(rule?.pattern || "");
    // Unsupported syntax is conservatively treated as potentially matching so
    // completeness becomes unknown instead of silently selecting no rule.
    return !classicPatternSupported(pattern) || patternMatchesBranch(pattern, base);
  });
}

function classicProtectionReadable(snapshot, matchingRules) {
  if (!sourceReadable(snapshot, "branchProtection")) return false;
  if (unsupportedClassicPatterns(snapshot).length > 0) return false;
  if (!matchingRules.length) return true;
  return snapshot?.evidence?.branchProtection !== null &&
    snapshot?.evidence?.branchProtection !== undefined;
}'''
text = replace_once(text, old, new, "classic protection completeness")
write(path, text)


# 4) Off-mode merge batching must not call the Windows Authority host.
path = "scripts/merge-pr-driver.mjs"
text = read(path)
text = replace_once(
    text,
    '''import {
  executeMutationWithAuthority,
  planMutationWithAuthority,
} from "./lib/mutation-execution-context.mjs";''',
    '''import {
  executeMutationWithAuthority,
  mutationAuthorityOptions,
  planMutationWithAuthority,
} from "./lib/mutation-execution-context.mjs";''',
    "merge driver authority import",
)
start = text.index("export function authorizeMergeRequests(")
end = text.index("\n\nexport function isFinalMergeOutcome", start)
replacement = '''export function authorizeMergeRequests(
  requests,
  {
    authorize = authorizeBatchSync,
    pipeName = process.env.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined,
    authorityMode = null,
  } = {},
) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error("merge_authority_requests_required");
  }
  if (authorityMode === "off") {
    return {
      batchId: null,
      expiresAt: null,
      approvalMethod: "authority_disabled_by_user",
      requests: requests.map((entry) => ({
        ...entry,
        request: { ...entry.request },
      })),
    };
  }
  const operations = requests.map(({ request }) => request);
  const authorization = authorize(operations, { pipeName });
  const batch = attachAuthorityGrants(operations, authorization);
  return {
    batchId: batch.batchId,
    expiresAt: batch.expiresAt,
    approvalMethod: authorization?.approvalMethod || "trusted_authority",
    requests: requests.map((entry, index) => ({
      ...entry,
      request: batch.requests[index],
    })),
  };
}'''
text = text[:start] + replacement + text[end:]
old = '''  const authorized = authorizeMergeRequests([{ name: "post_merge_thanks", request: thankRequest }]);'''
new = '''  const authorityMode = mutationAuthorityOptions({
    request: thankRequest,
    enforceHighAssurance: true,
  }).authorityMode;
  const authorized = authorizeMergeRequests(
    [{ name: "post_merge_thanks", request: thankRequest }],
    { authorityMode },
  );'''
text = replace_once(text, old, new, "post-merge off authority")
old = '''  const authorizedBatch = authorizeMergeRequests(requests);'''
new = '''  const authorityMode = mutationAuthorityOptions({
    request: mergeRequest,
    enforceHighAssurance: true,
  }).authorityMode;
  const authorizedBatch = authorizeMergeRequests(requests, { authorityMode });'''
text = replace_once(text, old, new, "merge off authority")
write(path, text)


# 5) Regression route may legitimately become null after stripping all untrusted text.
path = "tests/unit/audit-generation-10-regressions.test.mjs"
text = read(path)
old = '''    const route = routeShippingGithubPrompt(prompt);
    assert.ok(route, prompt);
    assert.notEqual(route.workflow, "references/merge-pr.md", prompt);
    assert.ok(!route.explicitActions.includes("merge_pr"), prompt);'''
new = '''    const route = routeShippingGithubPrompt(prompt);
    assert.notEqual(route?.workflow, "references/merge-pr.md", prompt);
    assert.ok(!route?.explicitActions?.includes("merge_pr"), prompt);'''
text = replace_once(text, old, new, "router regression null handling")
write(path, text)
