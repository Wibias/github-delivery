#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildFixturePlan, runFixtureScenario } from "./lib/live-github-fixture.mjs";

function parseArgs(argv) {
  const args = { repo: null, runId: null, baseBranch: "main", disposition: "close", receipt: null };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--run-id") args.runId = argv[++i];
    else if (value === "--base") args.baseBranch = argv[++i];
    else if (value === "--disposition") args.disposition = argv[++i];
    else if (value === "--receipt") args.receipt = argv[++i];
    else if (value.startsWith("--")) throw new Error(`unknown option: ${value}`);
    else positionals.push(value);
  }
  args.repo = positionals[0];
  args.runId ||= process.env.GITHUB_RUN_ID ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || "1"}` : null;
  if (!args.repo || !args.runId) throw new Error("Usage: node scripts/live-github-fixture.mjs OWNER/REPO --run-id ID [--base BRANCH] [--disposition close|merge] [--receipt FILE]");
  return args;
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(String(result.stderr || result.stdout || `${command} failed (${result.status})`).trim());
  return { status: result.status ?? 1, stdout: String(result.stdout || "").trim(), stderr: String(result.stderr || "").trim() };
}

function numberFromUrl(url) {
  const match = String(url).match(/\/(?:issues|pull)\/(\d+)(?:$|\?)/);
  if (!match) throw new Error(`unable to parse number from ${url}`);
  return Number(match[1]);
}

function gateDecision(repo, pr) {
  const result = run(process.execPath, ["scripts/ship-gate.mjs", repo, String(pr), "--mutation-mode", "read-only"], { allowFailure: true });
  const parsed = JSON.parse(result.stdout);
  return { decision: parsed.ready ? "ready" : parsed.blocked ? "blocked" : "unknown", raw: parsed };
}

function currentHead(repo, pr) {
  return run("gh", ["pr", "view", String(pr), "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"]).stdout;
}

function adapter(tempRoot) {
  return {
    async createIssue(plan) {
      const url = run("gh", ["issue", "create", "--repo", plan.repo, "--title", plan.issueTitle, "--body", `${plan.marker}\n\nTemporary lifecycle fixture. Safe to delete.`]).stdout;
      return { number: numberFromUrl(url), url };
    },
    async createBranch(plan) {
      run("git", ["fetch", "origin", plan.baseBranch]);
      run("git", ["switch", "--detach", `origin/${plan.baseBranch}`]);
      run("git", ["switch", "-C", plan.branch]);
      mkdirSync(join(process.cwd(), ".shipping-github-fixtures"), { recursive: true });
      writeFileSync(plan.fixturePath, JSON.stringify({ marker: plan.marker, generation: 1 }, null, 2) + "\n");
      run("git", ["add", plan.fixturePath]);
      run("git", ["-c", "user.name=shipping-github fixture", "-c", "user.email=fixture@users.noreply.github.com", "commit", "-m", `${plan.marker} create fixture`]);
      run("git", ["push", "origin", `HEAD:refs/heads/${plan.branch}`]);
    },
    async createDraftPr(plan, issue) {
      const url = run("gh", ["pr", "create", "--repo", plan.repo, "--base", plan.baseBranch, "--head", plan.branch, "--draft", "--title", plan.prTitle, "--body", `${plan.marker}\n\nExercises the live lifecycle harness.\n\nRelated fixture issue: #${issue.number}`]).stdout;
      return { number: numberFromUrl(url), url };
    },
    async evaluateGate(plan, pr) { return gateDecision(plan.repo, pr.number); },
    async markReady(plan, pr) { run("gh", ["pr", "ready", String(pr.number), "--repo", plan.repo]); },
    async waitForChecks(plan, pr) {
      const deadline = Date.now() + Number(process.env.FIXTURE_CHECK_TIMEOUT_MS || 15 * 60 * 1000);
      let observed = false;
      while (Date.now() < deadline) {
        const payload = JSON.parse(run("gh", ["pr", "view", String(pr.number), "--repo", plan.repo, "--json", "statusCheckRollup"]).stdout);
        const checks = payload.statusCheckRollup || [];
        if (checks.length) observed = true;
        const complete = new Set(["SUCCESS", "FAILURE", "CANCELLED", "SKIPPED", "NEUTRAL", "TIMED_OUT", "ACTION_REQUIRED", "STALE"]);
        const pending = checks.filter((check) => !complete.has(check.conclusion || check.state));
        const failed = checks.filter((check) => new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]).has(check.conclusion || check.state));
        if (observed && pending.length === 0) {
          if (failed.length) throw new Error(`fixture checks failed: ${failed.map((check) => check.name || check.context).join(", ")}`);
          return { conclusion: "success", count: checks.length };
        }
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
      if (!observed) return { conclusion: "none", count: 0 };
      throw new Error("timed out waiting for fixture checks");
    },
    async captureSnapshot(plan, pr) {
      const path = join(tempRoot, "snapshot.json");
      run(process.execPath, ["scripts/ship-gate-snapshot.mjs", plan.repo, String(pr.number), "--output", path]);
      const snapshot = JSON.parse(readFileSync(path, "utf8"));
      return { head: snapshot.headOid, path };
    },
    async changeHead(plan, pr) {
      writeFileSync(plan.fixturePath, JSON.stringify({ marker: plan.marker, generation: 2 }, null, 2) + "\n");
      run("git", ["add", plan.fixturePath]);
      run("git", ["-c", "user.name=shipping-github fixture", "-c", "user.email=fixture@users.noreply.github.com", "commit", "-m", `${plan.marker} advance fixture head`]);
      run("git", ["push", "origin", `HEAD:refs/heads/${plan.branch}`]);
      if (!currentHead(plan.repo, pr.number)) throw new Error("fixture head did not advance");
    },
    async attemptStaleHeadMutation(plan, pr, expectedHead) {
      const path = join(tempRoot, "stale-request.json");
      writeFileSync(path, JSON.stringify({ schemaVersion: 1, action: "change_draft_state", mutationMode: "maintainer", explicitInstruction: true, repo: plan.repo, pr: pr.number, expectedHead, ready: false }, null, 2));
      const result = run(process.execPath, ["scripts/github-mutate.mjs", "--request", path, "--execute"], { allowFailure: true });
      return { rejected: result.status !== 0 && /expected_head_mismatch/.test(`${result.stderr}\n${result.stdout}`) };
    },
    async mergePr(plan, pr) {
      const path = join(tempRoot, "merge-request.json");
      writeFileSync(path, JSON.stringify({ schemaVersion: 1, action: "merge_pr", mutationMode: "maintainer", explicitInstruction: true, repo: plan.repo, pr: pr.number, expectedHead: currentHead(plan.repo, pr.number), mergeMethod: "merge" }, null, 2));
      run(process.execPath, ["scripts/github-mutate.mjs", "--request", path, "--execute"]);
    },
    async closePr(plan, pr) { run("gh", ["pr", "close", String(pr.number), "--repo", plan.repo]); },
    async closeIssue(plan, issue) { run("gh", ["issue", "close", String(issue.number), "--repo", plan.repo, "--reason", "completed"]); },
    async deleteBranch(plan) { run("git", ["push", "origin", "--delete", plan.branch]); },
    async bestEffortCleanup(plan, { issue, pr }) {
      if (pr?.number) run("gh", ["pr", "close", String(pr.number), "--repo", plan.repo], { allowFailure: true });
      if (issue?.number) run("gh", ["issue", "close", String(issue.number), "--repo", plan.repo], { allowFailure: true });
      run("git", ["push", "origin", "--delete", plan.branch], { allowFailure: true });
    },
  };
}

const tempRoot = mkdtempSync(join(tmpdir(), "shipping-github-fixture-"));
try {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildFixturePlan(args);
  const receipt = await runFixtureScenario(adapter(tempRoot), plan);
  const output = JSON.stringify(receipt, null, 2) + "\n";
  if (args.receipt) writeFileSync(args.receipt, output);
  process.stdout.write(output);
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
