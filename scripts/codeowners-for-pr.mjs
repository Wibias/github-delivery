#!/usr/bin/env node
/**
 * List CODEOWNERS for files changed on a PR (base-branch CODEOWNERS).
 * Usage: node scripts/codeowners-for-pr.mjs OWNER/REPO PR_NUMBER
 * Requires: gh auth
 */
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";

const [repo, prRaw] = process.argv.slice(2);
if (!repo || !prRaw || !repo.includes("/")) {
  console.error("Usage: node scripts/codeowners-for-pr.mjs OWNER/REPO PR_NUMBER");
  process.exit(2);
}
const pr = Number(prRaw);
const [owner, name] = repo.split("/");

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `gh ${args.join(" ")} failed (${r.status})`);
  }
  return JSON.parse(r.stdout || "null");
}

function ghText(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `gh ${args.join(" ")} failed (${r.status})`);
  }
  return r.stdout;
}

function patternToRegex(pat) {
  let p = pat.trim();
  if (!p || p.startsWith("#")) return null;
  // CODEOWNERS: leading / = repo root; otherwise may match anywhere
  let anchoredRoot = false;
  if (p.startsWith("/")) {
    anchoredRoot = true;
    p = p.slice(1);
  }
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i++;
      if (p[i + 1] === "/") i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^$()[]{}|\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  if (dirOnly) re += "(?:/.*)?";
  if (anchoredRoot) return new RegExp("^" + re + "$");
  return new RegExp("(^|/)" + re + "$");
}

function parseCodeowners(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [pattern, ...owners] = parts;
    const rx = patternToRegex(pattern);
    if (!rx) continue;
    rules.push({ pattern, owners, rx });
  }
  return rules;
}

function ownersForPath(rules, filePath) {
  let matched = null;
  for (const rule of rules) {
    if (rule.rx.test(filePath)) matched = rule;
  }
  return matched ? { pattern: matched.pattern, owners: matched.owners } : null;
}

function fetchCodeowners(ref) {
  const candidates = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
  for (const path of candidates) {
    try {
      const meta = ghJson([
        "api",
        `repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      ]);
      if (meta?.content) {
        const text = Buffer.from(meta.content, "base64").toString("utf8");
        return { path, text };
      }
    } catch {
      // try next
    }
  }
  return null;
}

const prView = ghJson([
  "pr",
  "view",
  String(pr),
  "--repo",
  repo,
  "--json",
  "baseRefName,headRefOid,reviewRequests,reviewDecision,url",
]);

const files = [];
let page = 1;
for (;;) {
  const chunk = ghJson([
    "api",
    `repos/${owner}/${name}/pulls/${pr}/files?per_page=100&page=${page}`,
  ]);
  if (!Array.isArray(chunk) || chunk.length === 0) break;
  for (const f of chunk) files.push(f.filename);
  if (chunk.length < 100) break;
  page++;
}

let errors = [];
try {
  const errPayload = ghJson([
    "api",
    `repos/${owner}/${name}/codeowners/errors?ref=${encodeURIComponent(prView.baseRefName)}`,
  ]);
  errors = errPayload?.errors || [];
} catch {
  errors = [];
}

const co = fetchCodeowners(prView.baseRefName);
const rules = co ? parseCodeowners(co.text) : [];
const byFile = {};
const ownerSet = new Set();
for (const file of files) {
  const hit = ownersForPath(rules, file);
  byFile[file] = hit;
  if (hit) for (const o of hit.owners) ownerSet.add(o);
}

const reviewRequests = (prView.reviewRequests || []).map((r) => {
  const login = r?.login || r?.slug || r?.name || JSON.stringify(r);
  return login;
});

const out = {
  repo,
  pr,
  base: prView.baseRefName,
  codeownersPath: co?.path || null,
  codeownersErrors: errors,
  changedFiles: files.length,
  ownersUnion: [...ownerSet],
  reviewRequests,
  reviewDecision: prView.reviewDecision || null,
  files: byFile,
  url: prView.url,
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
if (errors.length) process.exitCode = 0; // informational
