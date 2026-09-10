import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "verify-review-verdict-completion.mjs");
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const RUN = "rr-42-test";

function fixture(name, value) {
  const dir = mkdtempSync(join(tmpdir(), "gd-review-completion-"));
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

function verdict(gate = "none") {
  return {
    id: 1,
    user: { login: "reviewer" },
    body: [
      "## [GD] Verdict: approve-comment",
      `<!-- github-delivery:full-review-verdict run:${RUN} head:${HEAD} -->`,
      "### TLDR",
      `- **Gate:** ${gate}`,
    ].join("\n"),
  };
}

test("offline completion verifier rejects stale owned Request changes", () => {
  const comments = fixture("comments.json", [verdict("review required")]);
  const reviews = fixture("reviews.json", [{ node_id: "PRR_pending", state: "CHANGES_REQUESTED", user: { login: "reviewer" } }]);
  const gate = fixture("gate.json", { decision: "blocked", blocked: true, unknown: false, blockers: ["reviewPolicy:changes_requested"] });

  const result = spawnSync(process.execPath, [COMMAND, "acme/widget", "42", "--run-id", RUN, "--head", HEAD, "--comments-file", comments, "--reviews-file", reviews, "--ship-gate-file", gate, "--viewer-login", "reviewer"], { cwd: ROOT, encoding: "utf8" });

  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.complete, false);
  assert.ok(output.problems.includes("owned_changes_requested_still_pending"));
});

test("offline completion verifier accepts accurate independent approval blocker", () => {
  const comments = fixture("comments.json", [verdict("independent approval still required")]);
  const reviews = fixture("reviews.json", []);
  const gate = fixture("gate.json", { decision: "blocked", blocked: true, unknown: false, blockers: ["reviewPolicy:review_required"] });

  const result = spawnSync(process.execPath, [COMMAND, "acme/widget", "42", "--run-id", RUN, "--head", HEAD, "--comments-file", comments, "--reviews-file", reviews, "--ship-gate-file", gate, "--viewer-login", "reviewer"], { cwd: ROOT, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.complete, true);
});
