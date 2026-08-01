import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "mutation-policy.mjs");

function run(args) {
  return spawnSync(process.execPath, [COMMAND, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

test("prints a complete profile", () => {
  const result = run(["review"]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "review");
  assert.ok(output.allowedActions.includes("post_review"));
  assert.equal(output.actions.resolve_thread.allowed, false);
});

test("returns one for a denied mutation", () => {
  const result = run(["maintainer", "merge_pr"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).reason, "explicit_instruction_required");
});

test("allows an explicitly instructed maintainer mutation", () => {
  const result = run(["maintainer", "merge_pr", "--explicit"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).allowed, true);
});
