import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";

import { isBotLogin } from "../../scripts/review-threads.mjs";
import { authorizeMutation } from "../../scripts/lib/mutation-policy.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "review-threads.mjs");

function run(extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      COMMAND,
      "Wibias/github-delivery",
      "42",
      "--resolve",
      "PRRT_example",
      ...extraArgs,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    },
  );
}

test("read-only mode denies thread resolution before invoking gh", () => {
  const result = run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mode_denied/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
});

test("maintainer mode requires explicit instruction", () => {
  const result = run(["--mutation-mode", "maintainer"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /explicit_instruction_required/);
});

test("review mode cannot resolve human threads through --explicit", () => {
  const result = run(["--mutation-mode", "review", "--explicit"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mode_denied/);
});

test("review mode authorizes resolve_bot_thread without explicit instruction", () => {
  const authorization = authorizeMutation({
    mode: "review",
    action: "resolve_bot_thread",
    explicitInstruction: false,
  });
  assert.equal(authorization.allowed, true);
  assert.equal(authorization.reason, null);
});

test("read-only mode denies resolve_bot_thread", () => {
  const authorization = authorizeMutation({
    mode: "read-only",
    action: "resolve_bot_thread",
    explicitInstruction: false,
  });
  assert.equal(authorization.allowed, false);
  assert.equal(authorization.reason, "mode_denied");
});

test("isBotLogin recognizes bot logins and rejects humans", () => {
  assert.equal(isBotLogin("coderabbitai[bot]"), true);
  assert.equal(isBotLogin("chatgpt-codex-connector[bot]"), true);
  assert.equal(isBotLogin("github-actions[bot]"), true);
  assert.equal(isBotLogin("some-agent[bot]"), true);
  assert.equal(isBotLogin("DevMello"), false);
  assert.equal(isBotLogin("Wibias"), false);
  assert.equal(isBotLogin(null), false);
  assert.equal(isBotLogin(""), false);
});

test("read-only mode is rejected for the full-review workflow", () => {
  const result = run([
    "--workflow",
    "references/full-review-pr.md",
    "--mutation-mode",
    "read-only",
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mode_denied_by_workflow/);
  assert.doesNotMatch(result.stderr, /ENOENT|spawn gh/i);
});
