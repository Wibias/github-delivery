const TREE_SHA_RE = /^[0-9a-f]{40,64}$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40,64}$/;

export function normalizeTreeSha(value, name) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) throw new Error(`${name}_required`);
  if (!TREE_SHA_RE.test(text)) throw new Error(`${name}_invalid`);
  return text;
}

function normalizeCommitSha(value, name) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) throw new Error(`${name}_required`);
  if (!COMMIT_SHA_RE.test(text)) throw new Error(`${name}_invalid`);
  return text;
}

export function assertContentPreservingRewrite({ originalTree, newTree } = {}) {
  const original = normalizeTreeSha(originalTree, "original_tree");
  const next = normalizeTreeSha(newTree, "new_tree");
  if (original !== next) {
    throw new Error(
      `content_preserving_rewrite_tree_mismatch: original ${original} new ${next}`,
    );
  }
  return { originalTree: original, newTree: next };
}

export function parseReflogGenerationEntries(text) {
  const entries = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, tree] = trimmed.split(/\s+/);
    if (!COMMIT_SHA_RE.test(sha || "") || !TREE_SHA_RE.test(tree || "")) {
      throw new Error("rewrite_baseline_generation_unproven");
    }
    entries.push({ sha: sha.toLowerCase(), tree: tree.toLowerCase() });
  }
  return entries;
}

export function assertRewriteBaselineGeneration({
  recorded,
  newTip,
  recordedTree,
  entries,
  isAncestor,
} = {}) {
  const baseline = normalizeCommitSha(recorded, "recorded");
  const tip = normalizeCommitSha(newTip, "new_tip");
  const tree = normalizeTreeSha(recordedTree, "recorded_tree");
  const log = Array.isArray(entries) ? entries : [];
  if (log.length === 0) {
    throw new Error("rewrite_baseline_generation_unproven");
  }
  const first = log[0] || {};
  const firstSha = normalizeCommitSha(first.sha, "reflog_sha");
  if (firstSha !== tip) {
    throw new Error(
      `rewrite_baseline_generation_tip_mismatch: expected ${tip} observed ${firstSha}`,
    );
  }
  let found = false;
  for (const entry of log) {
    const sha = normalizeCommitSha(entry?.sha, "reflog_sha");
    const entryTree = normalizeTreeSha(entry?.tree, "reflog_tree");
    if (entryTree !== tree) {
      const ancestorOfBaseline = typeof isAncestor === "function" && isAncestor(sha, baseline);
      if (!ancestorOfBaseline) {
        throw new Error(
          `rewrite_baseline_generation_stale: observed ${sha} tree ${entryTree} recorded tree ${tree}`,
        );
      }
    }
    if (sha === baseline) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error("rewrite_baseline_generation_unproven");
  return { recorded: baseline, newTip: tip, recordedTree: tree };
}
