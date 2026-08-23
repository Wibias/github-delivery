const TREE_SHA_RE = /^[0-9a-f]{40,64}$/;

export function normalizeTreeSha(value, name) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) throw new Error(`${name}_required`);
  if (!TREE_SHA_RE.test(text)) throw new Error(`${name}_invalid`);
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
