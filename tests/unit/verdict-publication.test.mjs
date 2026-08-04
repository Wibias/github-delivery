import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { findVerdictPublication } from "../../scripts/lib/verdict-publication.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "verify-verdict-published.mjs");
const RUN_ID = "fr-42-abc123-20260804";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

function comment(body, id = 42) {
  return {
    id,
    html_url: `https://github.com/acme/widget/pull/42#issuecomment-${id}`,
    user: { login: "Wibias" },
    body,
  };
}

function writeComments(comments) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-verdict-"));
  const path = join(directory, "comments.json");
  writeFileSync(path, JSON.stringify(comments), "utf8");
  return path;
}

function run(args) {
  return spawnSync(process.execPath, [COMMAND, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

test("finds the exact run marker with matching run id and head", () => {
  const comments = [
    comment("older verdict without a marker"),
    comment(
      `## [GD] Verdict: changes-requested\n<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${HEAD} -->`,
      99,
    ),
  ];
  const verdict = findVerdictPublication({ comments, runId: RUN_ID, head: HEAD });
  assert.equal(verdict.id, 99);
});

test("ignores verdicts for another run or another head", () => {
  const comments = [
    comment(
      `<!-- github-delivery:full-review-verdict run:fr-other head:${HEAD} -->`,
    ),
    comment(
      `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:ffffffffffffffffffffffffffffffffffffffff -->`,
    ),
  ];
  assert.equal(
    findVerdictPublication({ comments, runId: RUN_ID, head: HEAD }),
    null,
  );
});

test("verify CLI reports published for a matching comment", () => {
  const file = writeComments([
    comment(
      `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${HEAD} -->`,
      123,
    ),
  ]);
  const result = run([
    "acme/widget",
    "42",
    "--run-id",
    RUN_ID,
    "--head",
    HEAD,
    "--mutation-mode",
    "review",
    "--comments-file",
    file,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.verdictCommentId, 123);
  assert.equal(output.author, "Wibias");
  assert.equal(output.mutationMode, "review");
});

test("verify CLI fails closed when the verdict is not published", () => {
  const file = writeComments([
    comment(
      `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:ffffffffffffffffffffffffffffffffffffffff -->`,
    ),
  ]);
  const result = run([
    "acme/widget",
    "42",
    "--run-id",
    RUN_ID,
    "--head",
    HEAD,
    "--comments-file",
    file,
  ]);
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, false);
  assert.equal(output.reason, "verdict_not_published");
});

test("verify CLI rejects missing required arguments", () => {
  const result = run(["acme/widget", "42"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});
