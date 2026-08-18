const MEDIA_EXTENSION_RE = /\.(?:avif|gif|jpe?g|png|svg|webp|mp4|m4v|mov|webm)(?:[?#].*)?$/i;
const GITHUB_UPLOAD_RE = /^https:\/\/(?:github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+|(?:private-)?user-images\.githubusercontent\.com\/[^\s]+)(?:[?#].*)?$/i;
const GITHUB_UPLOAD_SCAN_RE = /https:\/\/(?:github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+|(?:private-)?user-images\.githubusercontent\.com\/[^\s<>"')]+)(?:[?#][^\s<>"')]+)?/gi;

function normalizeUrl(value) {
  const text = String(value || "").trim().replace(/^<|>$/g, "");
  return text || null;
}

function isMediaUrl(value) {
  const url = normalizeUrl(value);
  return Boolean(url && (MEDIA_EXTENSION_RE.test(url) || GITHUB_UPLOAD_RE.test(url)));
}

function addMatch(entries, seen, rawUrl, index, { requireRecognized = true } = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url || (requireRecognized && !isMediaUrl(url)) || seen.has(url)) return;
  seen.add(url);
  entries.push({ url, index });
}

export function extractPrBodyMedia(body = "") {
  const text = String(body || "");
  const entries = [];
  const seen = new Set();

  const markdownImage = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of text.matchAll(markdownImage)) {
    addMatch(entries, seen, match[1] || match[2], match.index ?? 0, { requireRecognized: false });
  }

  const markdownLink = /(?<!!)\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of text.matchAll(markdownLink)) {
    addMatch(entries, seen, match[1] || match[2], match.index ?? 0);
  }

  const htmlTag = /<(?:img|video|source)\b[^>]*>/gi;
  for (const tagMatch of text.matchAll(htmlTag)) {
    const tag = tagMatch[0];
    const baseIndex = tagMatch.index ?? 0;
    const attr = /\b(?:src|poster)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
    for (const attrMatch of tag.matchAll(attr)) {
      addMatch(entries, seen, attrMatch[1] || attrMatch[2] || attrMatch[3], baseIndex + (attrMatch.index ?? 0), {
        requireRecognized: false,
      });
    }
  }

  for (const match of text.matchAll(GITHUB_UPLOAD_SCAN_RE)) {
    addMatch(entries, seen, match[0], match.index ?? 0, { requireRecognized: false });
  }

  entries.sort((a, b) => a.index - b.index);
  return entries.map((entry) => entry.url);
}

export function diffPrBodyMedia(oldBody, newBody, approvedRemovals = []) {
  const oldMedia = extractPrBodyMedia(oldBody);
  const next = new Set(extractPrBodyMedia(newBody));
  const approved = new Set((approvedRemovals || []).map((entry) => String(entry)));
  const missing = oldMedia.filter((identity) => !next.has(identity));
  const approvedMissing = missing.filter((identity) => approved.has(identity));
  const unapprovedMissing = missing.filter((identity) => !approved.has(identity));
  return { missing, approvedMissing, unapprovedMissing };
}
