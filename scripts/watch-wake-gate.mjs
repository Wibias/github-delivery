#!/usr/bin/env node
/**
 * Watch wake gate: block idle/"waiting for CI/CodeRabbit" while work remains.
 *
 * Usage:
 *   node scripts/watch-wake-gate.mjs OWNER/REPO PR_NUMBER
 *
 * Exit 0 → may idle on CI/bots (owner comments cleared by a real commit; not DIRTY).
 * Exit 1 → must act (do NOT report waiting). See blockers[].
 * Exit 2 → usage / gh error.
 *
 * Trusted-human top-level comments clear ONLY via a later **non-merge** commit
 * on the PR head. A chatty
 *   [shipping-github] Addressed owner feedback — …
 * comment alone does **not** clear (that was gamed: ack + idle on conflicts).
 * Post the ACK *after* the fix commit if you want a paper trail.
 *
 * Also blocks when mergeStateStatus is DIRTY / CONFLICTING / BEHIND — update
 * from base / resolve; do not poll while conflicted.
 */
import { spawnSync } from "node:child_process";

const [repo, prRaw] = process.argv.slice(2);
if (!repo || !prRaw || !repo.includes("/")) {
  console.error("Usage: node scripts/watch-wake-gate.mjs OWNER/REPO PR_NUMBER");
  process.exit(2);
}

const pr = Number(prRaw);
const [owner, name] = repo.split("/");

function ghJson(args) {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `gh failed (${r.status})`);
  }
  const out = (r.stdout || "").trim();
  return out ? JSON.parse(out) : null;
}

function ghText(args) {
  const r = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `gh failed (${r.status})`);
  }
  return (r.stdout || "").trim();
}

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const BOT_RE = /\[bot\]$/i;
const AGENT_PREFIX_RE = /^#{0,3}\s*\[shipping-github\]/i;
const ACK_RE = /\[shipping-github\]\s*Addressed owner feedback/i;
const MERGE_COMMIT_RE =
  /^(Merge (branch|remote-tracking|pull request)|merge .* into |chore:\s*merge\b)/i;
const DIRTY_STATES = new Set(["DIRTY", "CONFLICTING", "BEHIND"]);

function isBotLogin(login) {
  if (!login) return true;
  return BOT_RE.test(login) || login === "github-actions";
}

try {
  const meta = ghJson([
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "url,headRefOid,commits,mergeStateStatus,mergeable,baseRefName",
  ]);

  const myLogin = ghText(["api", "user", "--jq", ".login"]);

  const issueComments = ghJson([
    "api",
    `repos/${owner}/${name}/issues/${pr}/comments?per_page=100`,
  ]);

  const commits = (meta.commits || []).map((c) => ({
    oid: c.oid || c.commit?.oid,
    message: (c.messageHeadline || c.commit?.messageHeadline || "").trim(),
    authoredDate: c.committedDate || c.commit?.authoredDate || c.authoredDate,
  }));

  const comments = (Array.isArray(issueComments) ? issueComments : []).map((c) => ({
    id: c.id,
    url: c.html_url,
    login: c.user?.login,
    association: c.author_association,
    createdAt: c.created_at,
    body: c.body || "",
  }));

  const blockers = [];

  const mergeState = meta.mergeStateStatus || "";
  if (DIRTY_STATES.has(mergeState) || meta.mergeable === "CONFLICTING") {
    blockers.push({
      id: null,
      author: null,
      association: null,
      createdAt: null,
      url: meta.url,
      excerpt: `mergeStateStatus=${mergeState} mergeable=${meta.mergeable}`,
      reason: "base_dirty_or_behind",
      howToClear: `Update from base \`${meta.baseRefName || "base"}\`, resolve conflicts, drop work already on tip if owner said it landed elsewhere, push a non-merge fix commit. Do not idle while DIRTY.`,
    });
  }

  const trusted = comments.filter((c) => {
    if (!TRUSTED.has(c.association)) return false;
    if (isBotLogin(c.login)) return false;
    if (myLogin && c.login === myLogin) return false;
    if (AGENT_PREFIX_RE.test(c.body.trim())) return false;
    if (ACK_RE.test(c.body)) return false;
    if (c.body.trim().length < 40) return false;
    return true;
  });

  for (const c of trusted) {
    const t = Date.parse(c.createdAt);
    const laterNonMergeCommit = commits.some((commit) => {
      if (!commit.authoredDate) return false;
      if (Date.parse(commit.authoredDate) <= t) return false;
      if (MERGE_COMMIT_RE.test(commit.message || "")) return false;
      return Boolean((commit.message || "").trim());
    });
    if (laterNonMergeCommit) continue;
    blockers.push({
      id: c.id,
      author: c.login,
      association: c.association,
      createdAt: c.createdAt,
      url: c.url,
      excerpt: c.body.replace(/\s+/g, " ").slice(0, 220),
      reason: "trusted_human_comment_needs_code",
      howToClear:
        "Act on the feedback in code (non-merge commit): rebase/drop overlap already on tip, keep leftover work, fix conflicts. Optional after push: [shipping-github] Addressed owner feedback — <one line>. ACK-only does NOT clear this gate.",
    });
  }

  const result = {
    repo,
    pr,
    url: meta.url,
    headRefOid: meta.headRefOid,
    mergeStateStatus: meta.mergeStateStatus,
    mergeable: meta.mergeable,
    canWait: blockers.length === 0,
    blockerCount: blockers.length,
    blockers,
    note: blockers.length
      ? "Do NOT report waiting for CI/CodeRabbit. Fix blockers (code + base), not ACK-only."
      : "Wake gate clear — CI/bot wait allowed.",
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(blockers.length ? 1 : 0);
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(2);
}
