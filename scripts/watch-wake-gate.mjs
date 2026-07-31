#!/usr/bin/env node
/**
 * Watch wake gate: block "waiting for CI/CodeRabbit" while trusted-human
 * PR conversation comments are still unaddressed.
 *
 * Usage:
 *   node scripts/watch-wake-gate.mjs OWNER/REPO PR_NUMBER
 *
 * Exit 0 → can idle on CI/bots (no unacked OWNER/MEMBER/COLLABORATOR comments).
 * Exit 1 → must triage/fix listed comments first (do NOT report waiting).
 * Exit 2 → usage / gh error.
 *
 * A comment is acked only when, after it, there is either:
 *   - a non-merge commit on the PR head, or
 *   - a later comment matching /\[shipping-github\]\s*Addressed owner feedback/i
 *
 * Top-level OWNER notes are often NOT in reviewThreads — this gate catches them.
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
    "url,headRefOid,commits,comments,author",
  ]);

  const myLogin = ghText(["api", "user", "--jq", ".login"]);

  // Full issue comments (gh pr view comments can be truncated / incomplete)
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

  const trusted = comments.filter((c) => {
    if (!TRUSTED.has(c.association)) return false;
    if (isBotLogin(c.login)) return false;
    // Operator's own notes/verdicts are not "incoming review" for this gate
    if (myLogin && c.login === myLogin) return false;
    if (AGENT_PREFIX_RE.test(c.body.trim())) return false;
    // ignore pure ACK markers themselves
    if (ACK_RE.test(c.body)) return false;
    // ignore trivial reactions-only / empty
    if (c.body.trim().length < 40) return false;
    return true;
  });

  const blockers = [];
  for (const c of trusted) {
    const t = Date.parse(c.createdAt);
    const laterAck = comments.some(
      (x) => Date.parse(x.createdAt) > t && ACK_RE.test(x.body),
    );
    const laterNonMergeCommit = commits.some((commit) => {
      if (!commit.authoredDate) return false;
      if (Date.parse(commit.authoredDate) <= t) return false;
      if (MERGE_COMMIT_RE.test(commit.message || "")) return false;
      // ignore empty messages
      return true;
    });
    if (laterAck || laterNonMergeCommit) continue;
    blockers.push({
      id: c.id,
      author: c.login,
      association: c.association,
      createdAt: c.createdAt,
      url: c.url,
      excerpt: c.body.replace(/\s+/g, " ").slice(0, 220),
      reason: "trusted_human_comment_unacked",
      howToClear:
        "Address in code (non-merge commit) or post: [shipping-github] Addressed owner feedback — <one line>",
    });
  }

  const result = {
    repo,
    pr,
    url: meta.url,
    headRefOid: meta.headRefOid,
    canWait: blockers.length === 0,
    blockerCount: blockers.length,
    blockers,
    note: blockers.length
      ? "Do NOT report waiting for CI/CodeRabbit. Triage blockers first."
      : "Wake gate clear — CI/bot wait allowed.",
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(blockers.length ? 1 : 0);
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(2);
}
