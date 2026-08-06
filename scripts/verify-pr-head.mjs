#!/usr/bin/env node
/**
 * One-call foreign-PR head verification: checkout the PR head in a temp
 * worktree, run install/typecheck/focused tests/lint/privacy, and print a
 * compact pass/fail table. Collapses the narrated verification ceremony.
 *
 * Usage:
 *   node scripts/verify-pr-head.mjs OWNER/REPO PR_NUMBER
 *     [--worktree-root D:\codex-worktrees]
 *     [--install-cmd "bun install"] [--typecheck-cmd "bun run typecheck"]
 *     [--gui-typecheck-cmd "cd gui && bun x tsc --noEmit -p tsconfig.app.json"]
 *     [--test-cmd "bun run test"] [--test-filter "claude-messages"]
 *     [--lint-cmd "bun run lint:gui"] [--privacy-cmd "bun run privacy:scan"]
 *     [--keep-worktree] [--timeout-ms N] [--json]
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const USAGE =
  "Usage: node scripts/verify-pr-head.mjs OWNER/REPO PR_NUMBER [--worktree-root DIR] [--install-cmd CMD] [--typecheck-cmd CMD] [--gui-typecheck-cmd CMD] [--test-cmd CMD] [--test-filter TEXT] [--lint-cmd CMD] [--privacy-cmd CMD] [--keep-worktree] [--timeout-ms N] [--json]";

export function parseArgs(argv) {
  const positional = [];
  const options = {
    worktreeRoot: null,
    installCmd: "bun install",
    typecheckCmd: "bun run typecheck",
    guiTypecheckCmd: null,
    testCmd: "bun run test",
    testFilter: null,
    lintCmd: "bun run lint:gui",
    privacyCmd: "bun run privacy:scan",
    keepWorktree: false,
    timeoutMs: 300_000,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--worktree-root") {
      options.worktreeRoot = argv[++index];
      if (!options.worktreeRoot) throw new Error("--worktree-root requires a path");
    } else if (value === "--install-cmd") {
      options.installCmd = argv[++index];
    } else if (value === "--typecheck-cmd") {
      options.typecheckCmd = argv[++index];
      if (!options.typecheckCmd) throw new Error("--typecheck-cmd requires a value");
    } else if (value === "--gui-typecheck-cmd") {
      options.guiTypecheckCmd = argv[++index];
      if (!options.guiTypecheckCmd) throw new Error("--gui-typecheck-cmd requires a value");
    } else if (value === "--test-cmd") {
      options.testCmd = argv[++index];
    } else if (value === "--test-filter") {
      options.testFilter = argv[++index];
    } else if (value === "--lint-cmd") {
      options.lintCmd = argv[++index];
    } else if (value === "--privacy-cmd") {
      options.privacyCmd = argv[++index];
    } else if (value === "--keep-worktree") {
      options.keepWorktree = true;
    } else if (value === "--timeout-ms") {
      options.timeoutMs = Number(argv[++index]);
      if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
        throw new Error("--timeout-ms requires a positive integer");
      }
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

function run(cmd, { cwd, timeoutMs }) {
  const started = Date.now();
  const result = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 200 * 1024 * 1024 });
  return {
    cmd,
    status: result.status,
    ok: result.status === 0,
    timedOut: result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM",
    elapsedMs: Date.now() - started,
    tail: String(result.stdout || result.stderr || "").trim().split(/\r?\n/).slice(-8).join("\n"),
  };
}

function findGuiTsconfig(cwd) {
  const candidates = ["tsconfig.app.json", "tsconfig.json", "tsconfig.web.json"];
  for (const candidate of candidates) {
    const probe = run(`test -f "gui/${candidate}" && echo found`, { cwd, timeoutMs: 10_000 });
    if (probe.ok && probe.tail.includes("found")) return candidate;
  }
  return null;
}

function guiTypecheckCommand(config) {
  // cd gui then run tsc against the GUI tsconfig, so the GUI's own type rules
  // (which the root tsconfig often excludes) are checked. This catches the
  // "local typecheck green, CI GUI typecheck red" class (PR #1108).
  return `cd gui && bun x tsc --noEmit -p ${config}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [owner, name] = args.repo.split("/");

  // Resolve PR head SHA.
  const head = run(`gh pr view ${args.pr} --repo ${args.repo} --json headRefOid --jq .headRefOid`, {
    cwd: process.cwd(),
    timeoutMs: 60_000,
  });
  if (!head.ok || !head.tail.trim()) {
    throw new Error(`could not resolve PR head: ${head.tail || head.cmd}`);
  }
  const headSha = head.tail.trim().split(/\r?\n/)[0].trim();

  // Find a local clone to create the worktree from. Prefer a repo root the
  // user already has; else the current directory if it's a git repo.
  const candidateRoots = [join("C:", "Users", "ws", "Desktop", "Anderes", "GitHub", name)];
  let cloneRoot = null;
  for (const root of candidateRoots) {
    const probe = run("git rev-parse --is-inside-work-tree", { cwd: root, timeoutMs: 10_000 });
    if (probe.ok) {
      cloneRoot = root;
      break;
    }
  }
  if (!cloneRoot) {
    const probe = run("git rev-parse --is-inside-work-tree", { cwd: process.cwd(), timeoutMs: 10_000 });
    if (probe.ok) cloneRoot = process.cwd();
  }
  if (!cloneRoot) throw new Error("no local git clone found to create the verification worktree from");

  // Ensure the PR head commit is present.
  run(`git fetch ${args.repo} ${headSha}`, { cwd: cloneRoot, timeoutMs: 120_000 });
  const base = run("git rev-parse --is-inside-work-tree", { cwd: cloneRoot, timeoutMs: 10_000 });
  if (!base.ok) throw new Error(`clone root ${cloneRoot} is not a git work tree`);

  const worktreeRoot = args.worktreeRoot || join("D:", "codex-worktrees");
  const worktreeName = `verify-pr-${args.pr}-${Date.now().toString(36)}`;
  const worktreePath = join(worktreeRoot, worktreeName);
  run(`mkdir -p "${worktreeRoot}"`, { cwd: cloneRoot, timeoutMs: 15_000 });
  const add = run(`git worktree add --detach "${worktreePath}" ${headSha}`, {
    cwd: cloneRoot,
    timeoutMs: 120_000,
  });
  if (!add.ok) {
    throw new Error(`worktree add failed: ${add.tail}`);
  }

  const results = {};
  try {
    results.install = run(args.installCmd, { cwd: worktreePath, timeoutMs: args.timeoutMs });
    results.typecheck = run(args.typecheckCmd, { cwd: worktreePath, timeoutMs: args.timeoutMs });
    if (args.guiTypecheckCmd) {
      results.guiTypecheck = run(args.guiTypecheckCmd, { cwd: worktreePath, timeoutMs: args.timeoutMs });
    } else {
      const guiConfig = findGuiTsconfig(worktreePath);
      if (guiConfig) {
        results.guiTypecheck = run(guiTypecheckCommand(guiConfig), { cwd: worktreePath, timeoutMs: args.timeoutMs });
      }
    }
    if (args.testCmd) {
      const testCmd = args.testFilter
        ? args.testCmd.replace(/^bun run test/, `bun run test --filter "${args.testFilter}"`)
        : args.testCmd;
      results.test = run(testCmd, { cwd: worktreePath, timeoutMs: args.timeoutMs });
    }
    if (args.lintCmd) results.lint = run(args.lintCmd, { cwd: worktreePath, timeoutMs: args.timeoutMs });
    if (args.privacyCmd) results.privacy = run(args.privacyCmd, { cwd: worktreePath, timeoutMs: args.timeoutMs });
  } finally {
    if (!args.keepWorktree) {
      run(`git worktree remove --force "${worktreePath}"`, { cwd: cloneRoot, timeoutMs: 60_000 });
    }
  }

  const summary = {
    schemaVersion: 1,
    kind: "github-delivery/verify-pr-head",
    repo: args.repo,
    pr: args.pr,
    headSha,
    worktree: args.keepWorktree ? worktreePath : null,
    results: Object.fromEntries(
      Object.entries(results).map(([key, value]) => [
        key,
        {
          ok: value.ok,
          status: value.status,
          timedOut: value.timedOut,
          elapsedMs: value.elapsedMs,
          tail: value.tail.slice(0, 400),
        },
      ]),
    ),
    allPassed: Object.values(results).every((value) => value.ok),
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const lines = [`# verify-pr-head: ${args.repo}#${args.pr} @ ${headSha.slice(0, 10)}`];
    for (const [key, value] of Object.entries(summary.results)) {
      const mark = value.ok ? "PASS" : value.timedOut ? "TIMEOUT" : "FAIL";
      lines.push(`- ${key}: ${mark} (${(value.elapsedMs / 1000).toFixed(1)}s)`);
      if (!value.ok && value.tail) lines.push(`    ${value.tail.replace(/\n/g, "\n    ")}`);
    }
    lines.push(`Overall: ${summary.allPassed ? "PASS" : "FAIL"}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  process.exitCode = summary.allPassed ? 0 : 1;
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
