import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { commandToSpawn, parseArgs, run } from "../../scripts/verify-pr-head.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/verify-pr-head.mjs", import.meta.url));

test("verify-pr-head parses repo and PR number", () => {
  const args = parseArgs(["acme/widget", "42"]);
  assert.equal(args.repo, "acme/widget");
  assert.equal(args.pr, 42);
  assert.equal(args.installCmd, "bun install");
  assert.equal(args.typecheckCmd, "bun run typecheck");
  assert.equal(args.testCmd, "bun run test");
  assert.equal(args.keepWorktree, false);
  assert.equal(args.json, false);
});

test("verify-pr-head accepts command overrides", () => {
  const args = parseArgs([
    "acme/widget",
    "42",
    "--worktree-root",
    "D:/codex-worktrees",
    "--install-cmd",
    "npm ci",
    "--typecheck-cmd",
    "npm run typecheck",
    "--gui-typecheck-cmd",
    "cd gui && npm run typecheck",
    "--test-cmd",
    "npm test",
    "--test-filter",
    "claude-messages",
    "--lint-cmd",
    "npm run lint",
    "--privacy-cmd",
    "npm run privacy",
    "--keep-worktree",
    "--json",
  ]);
  assert.equal(args.worktreeRoot, "D:/codex-worktrees");
  assert.equal(args.installCmd, "npm ci");
  assert.equal(args.guiTypecheckCmd, "cd gui && npm run typecheck");
  assert.equal(args.testFilter, "claude-messages");
  assert.equal(args.keepWorktree, true);
  assert.equal(args.json, true);
});

test("verify-pr-head rejects invalid input", () => {
  assert.throws(() => parseArgs(["acme/widget"]));
  assert.throws(() => parseArgs(["acme/widget", "abc"]));
  assert.throws(() => parseArgs(["acme/widget", "0"]));
  assert.throws(() => parseArgs(["norepo", "1"]));
});

test("verify-pr-head tokenizes a command into argv", () => {
  assert.deepEqual(commandToSpawn("git status"), {
    command: "git",
    args: ["status"],
    cwd: undefined,
  });
});

test("verify-pr-head turns cd && into a cwd shift instead of a shell", () => {
  const cwd = join(dirname(SCRIPT), "repo");
  assert.deepEqual(
    commandToSpawn("cd gui && bun x tsc --noEmit -p tsconfig.app.json", { cwd }),
    {
      command: "bun",
      args: ["x", "tsc", "--noEmit", "-p", "tsconfig.app.json"],
      cwd: join(cwd, "gui"),
    },
  );
});

test("verify-pr-head run spawns argv without a shell", () => {
  let captured;
  const result = run("git rev-parse --is-inside-work-tree", {
    cwd: "/tmp/repo",
    timeoutMs: 1_000,
    spawn(command, args, options) {
      captured = { command, args, options };
      return { status: 0, stdout: "true\n", stderr: "" };
    },
  });
  assert.equal(captured.command, "git");
  assert.deepEqual(captured.args, ["rev-parse", "--is-inside-work-tree"]);
  assert.equal(captured.options.shell, false);
  assert.equal(result.ok, true);
  assert.equal(result.status, 0);
});

test("verify-pr-head does not spawn a shell command string", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /boundedSpawnSync\([^;]*?,\s*\[\]/);
});
