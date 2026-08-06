import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../../scripts/verify-pr-head.mjs";

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
