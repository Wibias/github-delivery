#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

import { runGitHubCommandWithRetry } from "./lib/github-retry.mjs";
import {
  buildInterruptedReceipt,
  cleanupFixtureResources,
} from "./lib/live-fixture-cleanup.mjs";
import { verifyFixtureTargetIdentity } from "./lib/live-fixture-identity.mjs";
import { buildFixturePlan } from "./lib/live-github-fixture.mjs";
import {
  allowSameRepositoryFixture,
  assertFixtureRepositoryIsolation,
  fixtureRemoteName,
  fixtureRemoteUrl,
} from "./lib/live-fixture-target.mjs";

function parseArgs(argv) {
  const args = {
    repo: null,
    sourceRepo: null,
    fixtureRepoId: null,
    runId: null,
    baseBranch: "main",
    disposition: "close",
    receipt: "live-fixture-receipt.json",
    cleanupReport: "live-fixture-cleanup.json",
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--run-id") args.runId = argv[++index];
    else if (value === "--source-repo") args.sourceRepo = argv[++index];
    else if (value === "--fixture-repo-id") args.fixtureRepoId = argv[++index];
    else if (value === "--base") args.baseBranch = argv[++index];
    else if (value === "--disposition") args.disposition = argv[++index];
    else if (value === "--receipt") args.receipt = argv[++index];
    else if (value === "--cleanup-report") args.cleanupReport = argv[++index];
    else if (value.startsWith("--")) throw new Error(`unknown option: ${value}`);
    else positionals.push(value);
  }
  args.repo = positionals[0];
  args.sourceRepo ||= process.env.GITHUB_REPOSITORY || null;
  args.fixtureRepoId ||= process.env.LIVE_FIXTURE_REPOSITORY_ID || null;
  args.runId ||= process.env.GITHUB_RUN_ID
    ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`
    : null;
  if (!args.repo || !args.runId || !Number.isSafeInteger(Number(args.fixtureRepoId)) || Number(args.fixtureRepoId) <= 0) {
    throw new Error(
      "Usage: node scripts/cleanup-live-github-fixture.mjs FIXTURE_OWNER/FIXTURE_REPO --fixture-repo-id ID --run-id ID [--source-repo OWNER/REPO] [--base BRANCH] [--disposition close] [--receipt FILE] [--cleanup-report FILE]",
    );
  }
  args.fixtureRepoId = Number(args.fixtureRepoId);
  return args;
}

function execute(command, args, options = {}) {
  if (command === "gh") return runGitHubCommandWithRetry(command, args, { options });
  return spawnSync(command, args, options);
}

function run(command, args, { allowFailure = false } = {}) {
  const result = execute(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      String(result.stderr || result.stdout || `${command} failed (${result.status})`).trim(),
    );
  }
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function sourceRepository(args) {
  if (args.sourceRepo) return args.sourceRepo;
  const result = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  if (!result.stdout) throw new Error("source_repo_required");
  return result.stdout;
}

function ensureFixtureRemote(plan) {
  const remote = plan.gitRemote;
  const expectedUrl = fixtureRemoteUrl(plan.repo);
  const current = run("git", ["remote", "get-url", remote], { allowFailure: true });
  if (current.status === 0) {
    if (current.stdout !== expectedUrl) {
      run("git", ["remote", "set-url", remote, expectedUrl]);
    }
  } else {
    run("git", ["remote", "add", remote, expectedUrl]);
  }
  const verified = run("git", ["remote", "get-url", remote]).stdout;
  if (verified !== expectedUrl) {
    throw new Error(`fixture_remote_mismatch: expected ${expectedUrl}, observed ${verified || "missing"}`);
  }
  return remote;
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
      const rows = parseJson(
        run("gh", [
          "pr",
          "list",
          "--repo",
          plan.repo,
          "--state",
          "all",
          "--limit",
          "100",
          "--json",
          "number,state,title",
        ]),
        "unable to list fixture pull requests",
      );
      return exactResource(rows, plan.prTitle);
    },
    async findIssue(plan) {
      const rows = parseJson(
        run("gh", [
          "issue",
          "list",
          "--repo",
          plan.repo,
          "--state",
          "all",
          "--limit",
          "100",
          "--json",
          "number,state,title",
        ]),
        "unable to list fixture issues",
      );
      return exactResource(rows, plan.issueTitle);
    },
    async branchExists(plan) {
      const remote = ensureFixtureRemote(plan);
      const result = run(
        "git",
        ["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${plan.branch}`],
        { allowFailure: true },
      );
      if (result.status === 0) return true;
      if (result.status === 2) return false;
      throw new Error(result.stderr || "unable to inspect fixture branch");
    },
    async closePr(plan, pr) {
      run("gh", ["pr", "close", String(pr.number), "--repo", plan.repo]);
    },
    async closeIssue(plan, issue) {
      run("gh", [
        "issue",
        "close",
        String(issue.number),
        "--repo",
        plan.repo,
        "--reason",
        "not planned",
      ]);
    },
    async deleteBranch(plan) {
      if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
        run("gh", ["auth", "setup-git"]);
      }
      const remote = ensureFixtureRemote(plan);
      run("git", ["push", remote, "--delete", plan.branch]);
    },
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const sourceRepo = sourceRepository(args);
  const isolation = assertFixtureRepositoryIsolation({
    sourceRepo,
    fixtureRepo: args.repo,
    allowSameRepository: allowSameRepositoryFixture(process.env),
  });
  verifyFixtureTargetIdentity({
    sourceRepo: isolation.sourceRepo,
    fixtureRepo: isolation.fixtureRepo,
    expectedFixtureRepoId: args.fixtureRepoId,
    baseBranch: args.baseBranch,
    runner: execute,
  });
  const plan = buildFixturePlan({
    ...args,
    sourceRepo: isolation.sourceRepo,
    gitRemote: fixtureRemoteName(),
  });
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
