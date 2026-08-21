const STYLE_PATH_RE = /\.(?:css|scss|sass|less|styl)$/i;
const VISUAL_ASSET_RE = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const DOC_PATH_RE = /(^|\/)docs?\//i;
const UI_PATH_RE = /(^|\/)(?:app|pages?|views?|screens?|components?|ui|frontend|web|client)(\/|$)/i;
const UI_CODE_RE = /\.(?:html?|jsx?|tsx?|vue|svelte)$/i;
const VISUAL_LINE_RE = /(?:className=|class=|style=|<img\b|<svg\b|<video\b|<canvas\b|<button\b|<dialog\b|<input\b|<select\b|<textarea\b|display\s*:|grid|flex|padding|margin|font|color|background|border|width|height|position\s*:|aria-|role=)/i;
const TRAILING_INVISIBLE_RE = /[\p{Cf}\p{Cc}\p{Zs}]+$/u;

export function normalizeReviewPath(path) {
  return String(path ?? "").replace(TRAILING_INVISIBLE_RE, "");
}

function patchChangedLines(patch = "") {
  return String(patch).split(/\r?\n/).filter((line) =>
    (line.startsWith("+") && !line.startsWith("+++")) ||
    (line.startsWith("-") && !line.startsWith("---")),
  ).map((line) => line.slice(1));
}

function normalizeFile(raw = {}) {
  const path = String(raw.path ?? raw.filename ?? "").trim();
  if (!path) throw new Error("visual_evidence_file_path_required");
  return {
    path,
    previousPath: raw.previousPath ?? raw.previous_filename ?? null,
    status: String(raw.status ?? "modified"),
    patch: String(raw.patch ?? ""),
  };
}

function reasonFor(file) {
  const paths = [file.path, file.previousPath].filter(Boolean).map(normalizeReviewPath);
  if (paths.some((path) => STYLE_PATH_RE.test(path))) return { score: 6, reason: "stylesheet_changed" };
  if (paths.some((path) => VISUAL_ASSET_RE.test(path) && !DOC_PATH_RE.test(path))) {
    return { score: 5, reason: "visual_asset_changed" };
  }
  if (paths.some((path) => UI_CODE_RE.test(path) && UI_PATH_RE.test(path))) {
    const lines = patchChangedLines(file.patch);
    if (!file.patch || lines.some((line) => VISUAL_LINE_RE.test(line))) return { score: 5, reason: "ui_surface_changed" };
  }
  if (UI_CODE_RE.test(normalizeReviewPath(file.path)) && patchChangedLines(file.patch).some((line) => VISUAL_LINE_RE.test(line))) {
    return { score: 4, reason: "visual_markup_or_style_changed" };
  }
  return null;
}

export function planVisualEvidence(rawFiles = []) {
  const hits = [];
  let score = 0;
  for (const raw of rawFiles || []) {
    const file = normalizeFile(raw);
    const reason = reasonFor(file);
    if (!reason) continue;
    score = Math.max(score, reason.score);
    hits.push({ file: file.path, reason: reason.reason, score: reason.score });
  }
  return {
    required: hits.length > 0,
    confidence: score >= 6 ? "high" : score >= 4 ? "medium" : "none",
    files: [...new Set(hits.map((hit) => hit.file))].sort(),
    reasons: hits,
    acceptedEvidenceKinds: hits.length ? ["screenshot", "video", "render"] : [],
  };
}

function exactSha(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{40,64}$/.test(text) ? text : null;
}

function usableArtifact(artifact, expectedHead) {
  const kind = String(artifact?.kind ?? "").toLowerCase();
  if (!["screenshot", "video", "render"].includes(kind)) return false;
  const head = exactSha(artifact?.headRefOid);
  if (!head || head !== expectedHead) return false;
  const locator = String(artifact?.url ?? artifact?.path ?? artifact?.artifactId ?? "").trim();
  return Boolean(locator);
}

export function validateVisualEvidence({ plan, headRefOid, artifacts = [], blocker = null } = {}) {
  if (!plan?.required) return { state: "not_required", complete: true, artifacts: [] };
  const expectedHead = exactSha(headRefOid);
  if (!expectedHead) return { state: "unknown", complete: false, reason: "visual_evidence_head_missing", artifacts: [] };

  const validArtifacts = (artifacts || []).filter((artifact) => usableArtifact(artifact, expectedHead));
  if (validArtifacts.length > 0) {
    return { state: "satisfied", complete: true, artifacts: validArtifacts };
  }

  const blockerReason = String(blocker?.reason ?? "").trim();
  if (blocker?.state === "blocked" && blockerReason) {
    return { state: "blocked", complete: false, reason: blockerReason, artifacts: [] };
  }

  return { state: "missing", complete: false, reason: "visual_evidence_required", artifacts: [] };
}
