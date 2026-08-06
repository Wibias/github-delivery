#!/usr/bin/env node
/**
 * One-call CI forensics: for each failing required check on the PR head, fetch
 * the annotations and log tail, compare against the base SHA, and emit a
 * compact per-check origin verdict. Collapses the multi-turn "is this CI
 * failure mine or pre-existing?" investigation.
 *
 * Usage:
 *   node scripts/ci-forensics.mjs OWNER/REPO PR_NUMBER
 *     [--log-lines N] [--annotations N] [--json]
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { captureLiveSnapshot } from "./lib/live-snapshot.mjs";

const USAGE = "Usage: node scripts/ci-forensics.mjs OWNER/REPO PR_NUMBER [--log-lines N] [--annotations N] [--json]";

function parseArgs(argv) {
  const positional = [];
  const options = { logLines: 25, annotations: 10, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--log-lines") {
      options.logLines = Number(argv[++index]);
      if (!Number.isInteger(options.logLines) || options.logLines < 1) throw new Error("--log-lines requires a positive integer");
    } else if (value === "--annotations") {
      options.annotations = Number(argv[++index]);
      if (!Number.isInteger(options.annotations) || options.annotations < 1) throw new Error("--annotations requires a positive integer");
    } else if (value === "--json") {
      options.json = true;
    } else {
      positional.push(value);
    }
  }
  if (positional.length !== 2) throw new Error(USAGE);
  const repo = positional[0];
  const pr = Number(positional[1]);
  if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) throw new Error(USAGE);
  return { repo, pr, ...options };
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) {
    return { ok: false, error: String(result.stderr || result.stdout || "").trim().slice(0, 300), data: null };
  }
  try {
    return { ok: true, error: null, data: JSON.parse(result.stdout || "null") };
  } catch {
    return { ok: true, error: null, data: String(result.stdout || "").trim() };
  }
}

export function checkName(row) {
  return row?.name || row?.context || "unnamed";
}

export function conclusionOf(row) {
  const c = String(row?.conclusion || "").toUpperCase();
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c)) return "pass";
  if (["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STALE"].includes(c)) return "fail";
  return "pending";
}

export function failingChecks(rows = []) {
  const byName = new Map();
  for (const row of rows || []) {
    if (conclusionOf(row) !== "fail") continue;
    const name = checkName(row);
    const existing = byName.get(name);
    const startedAt = Date.parse(row?.started_at || "");
    const existingAt = existing ? Date.parse(existing.started_at || "") : 0;
    if (!existing || (Number.isFinite(startedAt) && startedAt > existingAt)) {
      byName.set(name, row);
    }
  }
  return [...byName.values()];
}

export function baseFailingNames(baseChecks) {
  const names = new Set();
  for (const row of baseChecks?.checkRuns || []) {
    if (conclusionOf(row) === "fail") names.add(checkName(row));
  }
  for (const row of baseChecks?.statuses || []) {
    const state = String(row?.state || "").toUpperCase();
    if (["FAILURE", "ERROR"].includes(state)) names.add(checkName(row));
  }
  return names;
}

export function classify(name, headFails, baseFailing) {
  if (baseFailing.has(name)) return "base_preexisting";
  return "pr_only_or_unknown";
}

function annotationsFor(checkRunId, repo, limit) {
  const result = gh(["api", `repos/${repo}/check-runs/${checkRunId}/annotations`, "--jq", `.[0:${limit}] | map({path, start_line, end_line, annotation_level, title, message})`]);
  if (!result.ok) return [];
  return Array.isArray(result.data) ? result.data : [];
}

function logTailFor(checkRunId, repo, lines) {
  const result = spawnSync(
    "gh",
    ["api", `repos/${repo}/actions/jobs/${checkRunId}/logs`],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    return `(log unavailable: ${String(result.stderr || result.stdout || "").trim().slice(0, 200)})`;
  }
  const tail = String(result.stdout || "").trim().split(/\r?\n/).slice(-lines).join("\n");
  return tail || "(empty log)";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = captureLiveSnapshot({ repo: args.repo, pr: args.pr });
  const headChecks = snapshot?.evidence?.checks || {};
  const baseHealth = snapshot?.evidence?.baseHealth || {};
  const headFailing = failingChecks(headChecks.checkRuns);
  const baseFailing = baseFailingNames(baseHealth.checks);

  const reports = headFailing.map((row) => {
    const name = checkName(row);
    const origin = classify(name, true, baseFailing);
    const checkRunId = row?.id || null;
    return {
      name,
      conclusion: row?.conclusion || null,
      origin,
      baseAlsoFails: baseFailing.has(name),
      annotations: checkRunId ? annotationsFor(checkRunId, args.repo, args.annotations) : [],
      logTail: checkRunId ? logTailFor(checkRunId, args.repo, args.logLines) : null,
    };
  });

  const summary = {
    schemaVersion: 1,
    kind: "github-delivery/ci-forensics",
    repo: args.repo,
    pr: args.pr,
    headOid: snapshot.headOid,
    baseOid: baseHealth.baseOid || null,
    baseRefName: baseHealth.baseRefName || null,
    failingCount: reports.length,
    checks: reports,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const out = [`# CI forensics: ${args.repo}#${args.pr} @ ${(snapshot.headOid || "").slice(0, 10)}`, `Base: ${summary.baseRefName} @ ${(summary.baseOid || "").slice(0, 10)}`, `Failing required checks: ${reports.length}`, ""];
  for (const report of reports) {
    out.push(`## ${report.name} — ${report.conclusion} (${report.origin})`);
    if (report.baseAlsoFails) out.push("  Base also fails this check → pre-existing.");
    else out.push("  Base passes this check → PR-introduced or infra.");
    if (report.annotations.length) {
      out.push("  Annotations:");
      for (const ann of report.annotations.slice(0, args.annotations)) {
        const loc = ann.path ? `${ann.path}:${ann.start_line || "?"}` : "(workflow)";
        out.push(`    [${ann.annotation_level}] ${loc}: ${String(ann.title || "").slice(0, 100)}`);
        if (ann.message) out.push(`      ${String(ann.message).replace(/\s+/g, " ").slice(0, 180)}`);
      }
    }
    if (report.logTail) {
      out.push("  Log tail:");
      for (const line of report.logTail.split("\n")) out.push(`    ${line}`);
    }
    out.push("");
  }
  process.stdout.write(`${out.join("\n")}\n`);
  process.exitCode = reports.some((r) => r.origin === "pr_only_or_unknown" && r.annotations.length === 0) ? 2 : 0;
}

if (process.argv[1]) {
  const invokedPath = realpathSync(process.argv[1]);
  if (import.meta.url === pathToFileURL(invokedPath).href) {
    main().catch((error) => {
      console.error(String(error?.message || error));
      process.exit(2);
    });
  }
}
