#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  buildInterruptedReceipt,
  cleanupFixtureResources,
} from "./lib/live-fixture-cleanup.mjs";
import { buildFixturePlan } from "./lib/live-github-fixture.mjs";

function parseArgs(argv) {
  const args = {
    repo: null,
    runId: null,
    baseBranch: "main",
    disposition: "close",
    receipt: "live-fixture-receipt.json",
    cleanupReport: "live-fixture-cleanup.json",
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--run-id") args.runId = argv[++index];
    else if (value === "--base") args.baseBranch = argv[++index];
    else if (value === "--disposition") args.disposition = argv[++index];
    else if (value === "--receipt") args.receipt = argv[++index];
    else if (value === "--cleanup-report") args.cleanupReport = argv[++index];
    else if (value.startsWith("--")) throw new Error(`unknown option: ${value}`);
    else positionals.push(value);
  }
  args.repo = positionals[0];
  args.runId ||= process.env.GITHUB_RUN_ID
    ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`
    : null;
  if (!args.repo || !args.runId) {
    throw new Error("Usage: node scripts/cleanup-live-github-fixture.mjs OWNER/REPO --run-id ID [--base BRANCH] [--disposition close|merge] [--receipt FILE] [--cleanup-report FILE]");
  }
  return args;
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${command} failed (${result.status})`).trim());
  }
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function parseJson(result, context) {
  if (result.status !== 0) throw new Error(`${context}: ${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout || "[]");
  } catch {
    throw new Error(`${context}: invalid JSON output`);
  }
}

function exactResource(items, title) {
  return items.find((item) => item?.title === title) || null;
}

function adapter() {
  return {
    async findPr(plan) {
      const rows = parseJson(run("gh", [
        "pr", "list", "--repo", plan.repo,
        "--state", "all", "--limit", "100",
        "--json", "number,state,title",
      ]), "unable to list fixture pull requests");
      return exactResource(rows, plan.prTitle);
    },
    async findIssue(plan) {
      const rows = parseJson(run("gh", [
        "issue", "list", "--repo", plan.repo,
        "--state", "all", "--limit", "100",
        "--json", "number,state,title",
      ]), "unable to list fixture issues");
      return exactResource(rows, plan.issueTitle);
    },
    async branchExists(plan) {
      const result = run("git", [
        "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${plan.branch}`,
      ], { allowFailure: true });
      if (result.status === 0) return true;
      if (result.status === 2) return false;
      throw new Error(result.stderr || "unable to inspect fixture branch");
    },
    async closePr(plan, pr) {
      run("gh", ["pr", "close", String(pr.number), "--repo", plan.repo]);
    },
    async closeIssue(plan, issue) {
      run("gh", ["issue", "close", String(issue.number), "--repo", plan.repo, "--reason", "not planned"]);
    },
    async deleteBranch(plan) {
      if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) run("gh", ["auth", "setup-git"]);
      run("git", ["push", "origin", "--delete", plan.branch]);
    },
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildFixturePlan(args);
  if (!existsSync(args.receipt)) {
    const receipt = buildInterruptedReceipt(plan);
    writeFileSync(args.receipt, JSON.stringify(receipt, null, 2) + "\n");
  }
  const report = await cleanupFixtureResources(adapter(), plan);
  writeFileSync(args.cleanupReport, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.complete) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 1;
}
