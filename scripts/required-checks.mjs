#!/usr/bin/env node
/**
 * Resolve required CI checks (legacy contexts + modern checks[]) vs PR rollup.
 * Usage: node scripts/required-checks.mjs OWNER/REPO PR_NUMBER
 * Requires: gh auth
 */
import { spawnSync } from "node:child_process";

const [repo, prRaw] = process.argv.slice(2);
if (!repo || !prRaw || !repo.includes("/")) {
  console.error("Usage: node scripts/required-checks.mjs OWNER/REPO PR_NUMBER");
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

function ghOk(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function namesFromRequiredStatusChecks(rsc) {
  if (!rsc) return [];
  const names = [];
  // Legacy: contexts: ["ci/travis"]
  if (Array.isArray(rsc.contexts)) names.push(...rsc.contexts);
  // Modern: checks: [{ context: "build", app_id: 123 }]
  if (Array.isArray(rsc.checks)) {
    for (const c of rsc.checks) {
      if (c?.context) names.push(c.context);
      else if (typeof c === "string") names.push(c);
    }
  }
  return uniq(names);
}

const prView = ghJson([
  "pr",
  "view",
  String(pr),
  "--repo",
  repo,
  "--json",
  "baseRefName,headRefOid,statusCheckRollup,mergeStateStatus,url",
]);

const base = prView.baseRefName;
const sha = prView.headRefOid;
const sources = [];
let required = [];
let strict = null;

// 1) Classic branch protection
const prot = ghOk([
  "api",
  `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
]);
if (prot.ok) {
  try {
    const body = JSON.parse(prot.stdout);
    const rsc = body.required_status_checks;
    const names = namesFromRequiredStatusChecks(rsc);
    if (names.length) {
      required.push(...names);
      sources.push("branch_protection");
    }
    if (typeof rsc?.strict === "boolean") strict = rsc.strict;
  } catch {
    // ignore
  }
} else {
  sources.push("branch_protection_unavailable");
}

// 2) Rulesets targeting the branch
const rules = ghOk([
  "api",
  `repos/${owner}/${name}/rules/branches/${encodeURIComponent(base)}`,
]);
if (rules.ok) {
  try {
    const list = JSON.parse(rules.stdout);
    if (Array.isArray(list)) {
      for (const rule of list) {
        if (rule?.type === "required_status_checks" && rule.parameters) {
          const names = namesFromRequiredStatusChecks({
            contexts: rule.parameters.required_status_checks?.map((x) => x.context) ||
              rule.parameters.contexts,
            checks: rule.parameters.required_status_checks || rule.parameters.checks,
          });
          // ruleset shape often: parameters.required_status_checks: [{ context }]
          const alt =
            rule.parameters.required_status_checks?.map((x) => x.context || x) || [];
          required.push(...names, ...alt);
          if (names.length || alt.length) sources.push("rulesets");
        }
      }
    }
  } catch {
    // ignore
  }
} else {
  sources.push("rulesets_unavailable");
}

required = uniq(required);

// 3) Live rollup / gh pr checks
const rollup = prView.statusCheckRollup || [];
const rollupRows = rollup.map((c) => ({
  name: c.name || c.context || c.workflowName || null,
  conclusion: c.conclusion || null,
  status: c.status || c.state || null,
  detailsUrl: c.detailsUrl || c.targetUrl || null,
}));

const checksCli = ghOk(["pr", "checks", String(pr), "--repo", repo, "--json", "name,state,bucket,link"]);
let checkRows = [];
if (checksCli.ok) {
  try {
    checkRows = JSON.parse(checksCli.stdout) || [];
  } catch {
    checkRows = [];
  }
}

function rowState(row) {
  const s = (row.state || row.status || row.conclusion || "").toUpperCase();
  if (["SUCCESS", "PASS", "SKIPPED", "NEUTRAL"].includes(s)) return "pass";
  if (["FAILURE", "FAIL", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(s))
    return "fail";
  if (["PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "PENDING"].includes(s)) return "pending";
  if (row.bucket === "pass") return "pass";
  if (row.bucket === "fail") return "fail";
  if (row.bucket === "pending") return "pending";
  return "unknown";
}

const liveByName = new Map();
for (const r of rollupRows) {
  if (r.name) liveByName.set(r.name, { ...r, gate: rowState(r) });
}
for (const r of checkRows) {
  if (r.name) liveByName.set(r.name, { name: r.name, link: r.link, gate: rowState(r) });
}

const requiredLive = required.map((n) => {
  const hit = liveByName.get(n);
  return { name: n, gate: hit?.gate || "missing", detail: hit || null };
});

// Heuristic when no required list: treat failing matrix jobs as blockers if mergeStateStatus bad
const heuristicFailing = [...liveByName.values()].filter((r) => r.gate === "fail");
const usedHeuristic = required.length === 0;

const out = {
  repo,
  pr,
  base,
  sha,
  strict,
  sources: uniq(sources),
  requiredNames: required,
  requiredStatus: requiredLive,
  requiredFailing: requiredLive.filter((r) => r.gate === "fail" || r.gate === "missing"),
  requiredPending: requiredLive.filter((r) => r.gate === "pending"),
  mergeStateStatus: prView.mergeStateStatus,
  allLive: [...liveByName.values()],
  heuristicFailing: usedHeuristic ? heuristicFailing : [],
  note: usedHeuristic
    ? "No protection/ruleset required list found — use mergeStateStatus + failing live checks; do not invent green."
    : "Required names taken from branch protection contexts/checks[] and/or rulesets.",
  url: prView.url,
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
const blocked =
  requiredLive.some((r) => r.gate === "fail" || r.gate === "pending" || r.gate === "missing") ||
  (usedHeuristic &&
    (prView.mergeStateStatus === "UNSTABLE" ||
      prView.mergeStateStatus === "BLOCKED" ||
      heuristicFailing.length > 0));
process.exitCode = blocked ? 1 : 0;
