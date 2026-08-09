import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "verify-verdict-published.mjs");
const RUN_ID = "fr-42-provenance";
const HEAD = "0123456789abcdef0123456789abcdef01234567";

function verdictBody() {
  return [
    "## [GD] Verdict: approve-comment",
    `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${HEAD} -->`,
    "",
    "### TLDR",
    "",
    "- **PR:** `#42` — widget",
    "- **Head:** `abc1234` on `dev`",
    "- **Decision:** useful and ready",
    "- **Usefulness:** fixes a real bug",
    "- **Bugs:** none blocking",
    "- **Security:** none",
    "- **Spec / standards:** clean",
    "- **Reviews:** humans + bots clear",
    "- **Base / CI:** green",
    "- **Gate:** none",
    "- **Owner actions (foreign PR):** none",
    "- **Bottom line:** ship it",
    "",
    "<details>",
    "<summary><b>Full verdict</b></summary>",
    "",
    "full detail",
    "",
    "</details>",
  ].join("\n");
}

function writeComments(login) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-verdict-provenance-"));
  const path = join(directory, "comments.json");
  writeFileSync(
    path,
    JSON.stringify([
      {
        id: 123,
        html_url: "https://github.com/acme/widget/pull/42#issuecomment-123",
        user: { login },
        body: verdictBody(),
      },
    ]),
    "utf8",
  );
  return path;
}

function run(login) {
  return spawnSync(
    process.execPath,
    [
      COMMAND,
      "acme/widget",
      "42",
      "--run-id",
      RUN_ID,
      "--head",
      HEAD,
      "--comments-file",
      writeComments(login),
      "--publisher-login",
      "Wibias",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
}

test("rejects a format-valid verdict marker published by an untrusted actor", () => {
  const result = run("mallory");
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, false);
  assert.equal(output.expectedPublisher, "Wibias");
  assert.equal(output.ignoredUntrustedComments, 1);
  assert.equal(output.reason, "verdict_not_published");
});

test("accepts the same verdict when it belongs to the authenticated publisher", () => {
  const result = run("Wibias");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.author, "Wibias");
  assert.equal(output.expectedPublisher, "Wibias");
  assert.equal(output.ignoredUntrustedComments, 0);
});
