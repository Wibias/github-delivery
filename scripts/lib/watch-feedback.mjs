const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const BOT_RE = /\[bot\]$/i;
const AGENT_PREFIX_RE = /^#{0,3}\s*\[shipping-github\]/i;
const ACK_RE = /\[shipping-github\]\s*Addressed owner feedback/i;
const MERGE_COMMIT_RE =
  /^(Merge (branch|remote-tracking|pull request)|merge .* into |chore:\s*merge\b)/i;

export function normalizeFeedback(raw, kind) {
  return {
    key: `${kind}:${raw?.id ?? raw?.node_id ?? "unknown"}`,
    id: raw?.id ?? null,
    kind,
    url: raw?.html_url || raw?.url || null,
    login: raw?.user?.login || raw?.author?.login || null,
    association: raw?.author_association || raw?.authorAssociation || null,
    createdAt: raw?.created_at || raw?.submitted_at || raw?.createdAt || null,
    body: raw?.body || "",
    path: raw?.path || null,
    line: raw?.line || raw?.original_line || null,
  };
}

export function isTrustedHumanFeedback(comment, { myLogin = null } = {}) {
  if (!TRUSTED.has(comment?.association)) return false;
  if (
    !comment?.login ||
    BOT_RE.test(comment.login) ||
    comment.login === "github-actions"
  ) {
    return false;
  }
  if (myLogin && comment.login === myLogin) return false;
  const body = String(comment.body || "").trim();
  if (!body) return false;
  if (AGENT_PREFIX_RE.test(body) || ACK_RE.test(body)) return false;
  return true;
}

export function findUnaddressedFeedback({
  feedback = [],
  commits = [],
  myLogin = null,
} = {}) {
  return feedback.filter((comment) => {
    if (!isTrustedHumanFeedback(comment, { myLogin })) return false;
    const created = Date.parse(comment.createdAt || "");
    if (!Number.isFinite(created)) return true;
    const laterNonMergeCommit = commits.some((commit) => {
      const committed = Date.parse(
        commit?.authoredDate || commit?.committedDate || "",
      );
      if (!Number.isFinite(committed) || committed <= created) return false;
      const message = String(commit?.message || "").trim();
      return Boolean(message) && !MERGE_COMMIT_RE.test(message);
    });
    return !laterNonMergeCommit;
  });
}
