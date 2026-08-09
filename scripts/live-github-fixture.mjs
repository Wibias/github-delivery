#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { waitForExpectedChecks } from "./lib/live-fixture-checks.mjs";
import { parseFixtureGateResult } from "./lib/live-fixture-gate-result.mjs";
import { waitForObservedHead } from "./lib/live-fixture-head.mjs";
import { buildFixturePlan, runFixtureScenario } from "./lib/live-github-fixture.mjs";
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
    runId: null,
    baseBranch: "main",
    disposition: "close",
    receipt: null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--run-id") args.runId = argv[++i];
    else if (value === "--source-repo") args.sourceRepo = argv[++i];
    else if (value === "--base") args.baseBranch = argv[++i];
    else if (value === "--disposition") args.disposition = argv[++i];
    else if (value === "--receipt") args.receipt = argv[++i];
    else if (value.startsWith("--")) throw new Error(`unknown option: ${value}`);
    else positionals.push(value);
  }
  args.repo = positionals[0];
  args.sourceRepo ||= process.env.GITHUB_REPOSITORY || null;
  args.runId ||= process.env.GITHUB_RUN_ID
    ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`
    : null;
  if (!args.repo || !args.runId) {
    throw new Error(
      "Usage: node scripts/live-github-fixture.mjs FIXTURE_OWNER/FIXTURE_REPO --run-id ID [--source-repo OWNER/REPO] [--base BRANCH] [--disposition close] [--receipt FILE]",
    );
  }
  if (args.disposition !== "close") {
    throw new Error("--disposition supports only close; merge requires a real trusted authority grant");
  }
  return args;
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
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

function parseJsonOutput(result, fallback, context) {
  if (!result.stdout) {
    if (result.status === 0 || /no checks reported|no runs found/i.test(result.stderr)) return fallback;
    throw new Error(`${context}: ${result.stderr || `command failed (${result.status})`}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${context}: command returned invalid JSON: ${result.stdout.slice(0, 300)}`);
  }
}

function numberFromUrl(url) {
  const match = String(url).match(/\/(?:issues|pull)\/(\d+)(?:$|\?)/);
  if (!match) throw new Error(`unable to parse number from ${url}`);
  return Number(match[1]);
}

function gateDecision(repo, pr) {
  const result = run(
    process.execPath,
    ["scripts/ship-gate.mjs", repo, String(pr), "--mutation-mode", "read-only"],
    { allowFailure: true },
  );
  return parseFixtureGateResult(result);
}

function currentHead(repo, pr) {
  return run("gh", [
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "headRefOid",
    "--jq",
    ".headRefOid",
  ]).stdout;
}

function readPrChecks(repo, pr) {
  const result = run(
    "gh",
    [
      "pr",
      "checks",
      String(pr),
      "--repo",
      repo,
      "--json",
      "name,workflow,bucket,state,link,event",
    ],
    { allowFailure: true },
  );
  return parseJsonOutput(result, [], "unable to read fixture PR checks");
}

function readPrWorkflowRuns(repo, pr) {
  const head = currentHead(repo, pr);
  const result = run(
    "gh",
    [
      "api",
      "-X",
      "GET",
      `repos/${repo}/actions/runs`,
      "-f",
      `head_sha=${head}`,
      "-f",
      "event=pull_request",
      "-f",
      "per_page=100",
    ],
    { allowFailure: true },
  );
  const payload = parseJsonOutput(
    result,
    { workflow_runs: [] },
    "unable to read fixture workflow runs",
  );
  return Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
}

function adapter(tempRoot) {
  return {
    async createIssue(plan) {
      const url = run("gh", [
        "issue",
        "create",
        "--repo",
        plan.repo,
        "--title",
        plan.issueTitle,
        "--body",
        `${plan.marker}\n\nTemporary lifecycle fixture. Safe to delete.`,
      ]).stdout;
      return { number: numberFromUrl(url), url };
    },
    async createBranch(plan) {
      if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
        run("gh", ["auth", "setup-git"]);
      }
      const remote = ensureFixtureRemote(plan);
      run("git", ["fetch", remote, plan.baseBranch]);
      run("git", ["switch", "-C", plan.branch]);
      mkdirSync(join(process.cwd(), ".github-delivery-fixtures"), { recursive: true });
      writeFileSync(
        plan.fixturePath,
        JSON.stringify(
          {
            marker: plan.marker,
            generation: 1,
            sourceRepo: plan.sourceRepo,
            fixtureRepo: plan.repo,
          },
          null,
          2,
        ) + "\n",
      );
      run("git", ["add", plan.fixturePath]);
      run("git", [
        "-c",
        "user.name=github-delivery fixture",
        "-c",
        "user.email=fixture@users.noreply.github.com",
        "commit",
        "-m",
        `${plan.marker} create fixture`,
      ]);
      run("git", ["push", remote, `HEAD:refs/heads/${plan.branch}`]);
    },
    async createDraftPr(plan, issue) {
      const url = run("gh", [
        "pr",
        "create",
        "--repo",
        plan.repo,
        "--base",
        plan.baseBranch,
        "--head",
        plan.branch,
        "--draft",
        "--title",
        plan.prTitle,
        "--body",
        `${plan.marker}\n\nExercises the live lifecycle harness.\n\nSource repository: ${plan.sourceRepo}.\n\nRelated fixture issue: #${issue.number}`,
      ]).stdout;
      return { number: numberFromUrl(url), url };
    },
    async evaluateGate(plan, pr) {
      return gateDecision(plan.repo, pr.number);
    },
    async markReady(plan, pr) {
      run("gh", ["pr", "ready", String(pr.number), "--repo", plan.repo]);
    },
    async waitForChecks(plan, pr) {
      return waitForExpectedChecks({
        readChecks: async () => readPrChecks(plan.repo, pr.number),
        readRuns: async () => readPrWorkflowRuns(plan.repo, pr.number),
        timeoutMs: Number(process.env.FIXTURE_CHECK_TIMEOUT_MS || 15 * 60 * 1000),
        intervalMs: Number(process.env.FIXTURE_CHECK_INTERVAL_MS || 10 * 1000),
        onProgress(result) {
          console.error(`[live-fixture] ${result.code}: ${result.message}`);
        },
      });
    },
    async captureSnapshot(plan, pr) {
      const path = join(tempRoot, "snapshot.json");
      run(process.execPath, [
        "scripts/actions-ship-gate-snapshot.mjs",
        plan.repo,
        String(pr.number),
        "--output",
        path,
      ]);
      const snapshot = JSON.parse(readFileSync(path, "utf8"));
      return { head: snapshot.headOid, path };
    },
    async changeHead(plan, pr) {
      writeFileSync(
        plan.fixturePath,
        JSON.stringify(
          {
            marker: plan.marker,
            generation: 2,
            sourceRepo: plan.sourceRepo,
            fixtureRepo: plan.repo,
          },
          null,
          2,
        ) + "\n",
      );
      run("git", ["add", plan.fixturePath]);
      run("git", [
        "-c",
        "user.name=github-delivery fixture",
        "-c",
        "user.email=fixture@users.noreply.github.com",
        "commit",
        "-m",
        `${plan.marker} advance fixture head`,
      ]);
      const expectedHead = run("git", ["rev-parse", "HEAD"]).stdout;
      const remote = ensureFixtureRemote(plan);
      run("git", ["push", remote, `HEAD:refs/heads/${plan.branch}`]);
      await waitForObservedHead({
        readHead: async () => currentHead(plan.repo, pr.number),
        expectedHead,
        timeoutMs: Number(process.env.FIXTURE_HEAD_TIMEOUT_MS || 60 * 1000),
        intervalMs: Number(process.env.FIXTURE_HEAD_INTERVAL_MS || 1 * 1000),
      });
      return { head: expectedHead };
    },
    async attemptStaleHeadMutation(plan, pr, expectedHead) {
      const path = join(tempRoot, "stale-request.json");
      writeFileSync(
        path,
        JSON.stringify(
          {
            schemaVersion: 1,
            action: "change_draft_state",
            mutationMode: "maintainer",
            explicitInstruction: true,
            repo: plan.repo,
            pr: pr.number,
            expectedHead,
            ready: false,
          },
          null,
          2,
        ),
      );
      const result = run(
        process.execPath,
        ["scripts/github-mutate.mjs", "--request", path, "--execute"],
        { allowFailure: true },
      );
      return {
        rejected:
          result.status !== 0 &&
          /expected_head_mismatch/.test(`${result.stderr}\n${result.stdout}`),
      };
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
        "completed",
      ]);
    },
    async deleteBranch(plan) {
      const remote = ensureFixtureRemote(plan);
      run("git", ["push", remote, "--delete", plan.branch]);
    },
    async bestEffortCleanup(plan, { issue, pr }) {
      if (pr?.number) {
        run("gh", ["pr", "close", String(pr.number), "--repo", plan.repo], {
          allowFailure: true,
        });
      }
      if (issue?.number) {
        run("gh", ["issue", "close", String(issue.number), "--repo", plan.repo], {
          allowFailure: true,
        });
      }
      try {
        const remote = ensureFixtureRemote(plan);
        run("git", ["push", remote, "--delete", plan.branch], { allowFailure: true });
      } catch {
        // Cleanup is best effort; the standalone cleanup job repeats exact-resource cleanup.
      }
    },
  };
}

const tempRoot = mkdtempSync(join(tmpdir(), "github-delivery-fixture-"));
let parsedArgs = null;
try {
  parsedArgs = parseArgs(process.argv.slice(2));
  const sourceRepo = sourceRepository(parsedArgs);
  const isolation = assertFixtureRepositoryIsolation({
    sourceRepo,
    fixtureRepo: parsedArgs.repo,
    allowSameRepository: allowSameRepositoryFixture(process.env),
  });
  const plan = buildFixturePlan({
    ...parsedArgs,
    sourceRepo: isolation.sourceRepo,
    gitRemote: fixtureRemoteName(),
  });
  const receipt = await runFixtureScenario(adapter(tempRoot), plan);
  const output = JSON.stringify(receipt, null, 2) + "\n";
  if (parsedArgs.receipt) writeFileSync(parsedArgs.receipt, output);
  process.stdout.write(output);
} catch (error) {
  if (parsedArgs?.receipt && error?.fixtureReceipt) {
    try {
      writeFileSync(
        parsedArgs.receipt,
        JSON.stringify(error.fixtureReceipt, null, 2) + "\n",
      );
    } catch (receiptError) {
      console.error(
        `unable to persist failure receipt: ${receiptError?.message || receiptError}`,
      );
    }
  }
  console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
