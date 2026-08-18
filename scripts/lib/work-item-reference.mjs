const WORK_ITEM_KEY_RE = /\b([A-Z][A-Z0-9]*-\d+)\b/gi;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function repoEquals(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function safeHttpUrl(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

function normalizeKey(value) {
  const match = String(value || "").match(/\b([A-Z][A-Z0-9]*-\d+)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function keysFromText(value) {
  const keys = [];
  const seen = new Set();
  const text = String(value || "");
  for (const match of text.matchAll(WORK_ITEM_KEY_RE)) {
    const key = match[1].toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function uniqueCandidates(candidates) {
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const identity = `${candidate.kind}\u0000${candidate.key}\u0000${candidate.url || ""}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(candidate);
  }
  return out;
}

function decide(candidates) {
  const unique = uniqueCandidates(candidates);
  if (unique.length === 0) return null;
  if (unique.length === 1) {
    return { state: "resolved", reference: unique[0], candidates: unique };
  }
  return { state: "ambiguous", candidates: unique };
}

function githubIssueCandidates(repository, issueLinks) {
  return (issueLinks || []).flatMap((entry) => {
    const number = Number(entry?.number);
    const issueRepo = entry?.repository || repository;
    if (!Number.isInteger(number) || number <= 0 || !repoEquals(issueRepo, repository)) return [];
    return [{
      kind: "github-issue",
      key: `#${number}`,
      url: safeHttpUrl(entry?.url),
      source: "github-issue-link",
      tier: 1,
    }];
  });
}

function externalLinkCandidates(externalLinks) {
  return (externalLinks || []).flatMap((entry) => {
    const rawUrl = entry?.url ? String(entry.url) : null;
    const key = normalizeKey(entry?.key) || normalizeKey(rawUrl);
    if (!key) return [];
    return [{
      kind: "external",
      key,
      url: safeHttpUrl(rawUrl),
      source: "external-link",
      tier: 2,
    }];
  });
}

function explicitUrlCandidates(...values) {
  const candidates = [];
  for (const value of values) {
    const text = String(value || "");
    for (const match of text.matchAll(URL_RE)) {
      const url = safeHttpUrl(match[0]);
      const key = normalizeKey(url);
      if (!url || !key) continue;
      candidates.push({
        kind: "external",
        key,
        url,
        source: "external-url",
        tier: 2,
      });
    }
  }
  return candidates;
}

function textCandidates(value, source, tier) {
  return keysFromText(value).map((key) => ({
    kind: "external",
    key,
    url: null,
    source,
    tier,
  }));
}

export function extractWorkItemReferences({
  repository,
  issueLinks = [],
  externalLinks = [],
  headRefName = "",
  title = "",
  body = "",
} = {}) {
  const tiers = [
    githubIssueCandidates(repository, issueLinks),
    [
      ...externalLinkCandidates(externalLinks),
      ...explicitUrlCandidates(title, body),
    ],
    textCandidates(headRefName, "head-ref", 3),
    textCandidates(title, "title", 4),
    textCandidates(body, "body", 5),
  ];

  for (const candidates of tiers) {
    const result = decide(candidates);
    if (result) return result;
  }
  return { state: "none", candidates: [] };
}
