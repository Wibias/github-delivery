import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  findVerdictPublication,
  validateVerdictFormat,
} from "../../scripts/lib/verdict-publication.mjs";

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

function verdictBody() {
  const bullets = [
    "**PR:** `#42` — widget",
    "**Head:** `abc1234` on `dev`",
    "**Decision:** useful and ready",
    "**Usefulness:** fixes a real bug",
    "**Bugs:** none blocking",
    "**Security:** none",
    "**Spec / standards:** clean",
    "**Reviews:** humans + bots clear",
    "**Base / CI:** green",
    "**Gate:** none",
    "**Owner actions (foreign PR):** none",
    "**Bottom line:** ship it",
  ]
    .map((line) => `- ${line}`)
    .join("\n");
  return [
    "## [GD] Verdict: approve-comment",
    `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${HEAD} -->`,
    "",
    "### TLDR",
    "",
    bullets,
    "",
    "<details>",
    "<summary><b>Full verdict</b></summary>",
    "",
    "### Semantic propagation",
    "",
    "full detail here",
    "",
    "</details>",
  ].join("\n");
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
    comment(verdictBody(), 123),
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
  assert.equal(output.format.valid, true);
  assert.deepEqual(output.format.problems, []);
  assert.equal(output.reason, null);
  assert.equal(output.verdictCommentId, 123);
  assert.equal(output.author, "Wibias");
  assert.equal(output.mutationMode, "review");
});

test("verify CLI fails a published verdict that lacks the TLDR structure", () => {
  // Regression shape: the #1003 verdict posted 2026-08-04 — marker present,
  // but old-style `## [GD] Full review` heading, `### Verdict` instead of
  // `### TLDR`, and no `<details>` dropdown.
  const file = writeComments([
    comment(
      [
        `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${HEAD} -->`,
        "",
        "## [GD] Full review — feat(routing): record durable route decision traces (#1003)",
        "",
        "### Verdict",
        "",
        "**Approve for merge** pending the maintainer's final call. No Critical or High findings remain.",
        "",
        "### CodeRabbit findings (12) — triage",
        "",
        "**Resolved (10):** master plan, ledger, router, trace, request-log, tests.",
        "",
        "### Verification (exact)",
        "",
        "- `bun x tsc --noEmit` — PASSED",
        "- `bun run test tests/route-decision-trace.test.ts` — 17/17",
      ].join("\n"),
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
    "--comments-file",
    file,
  ]);
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.reason, "verdict_format_invalid");
  assert.equal(output.format.valid, false);
  assert.ok(output.format.problems.includes("verdict_heading_missing"));
  assert.ok(output.format.problems.includes("tldr_heading_missing"));
  assert.ok(output.format.problems.includes("details_dropdown_missing"));
});

test("validateVerdictFormat requires every TLDR bullet", () => {
  const result = validateVerdictFormat({
    body: [
      "## [GD] Verdict: approve-comment",
      "### TLDR",
      "",
      "- **PR:** `#42` — widget",
      "- **Head:** `abc1234` on `dev`",
      "- **Usefulness:** fixes a real bug",
      "- **Bugs:** none blocking",
      "- **Security:** none",
      "- **Spec / standards:** clean",
      "- **Reviews:** humans + bots clear",
      "- **Base / CI:** green",
      "- **Gate:** none",
      "- **Owner actions (foreign PR):** none",
      "",
      "<details>",
      "<summary><b>Full verdict</b></summary>",
      "detail",
      "</details>",
    ].join("\n"),
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.problems.includes("tldr_bullets_missing:decision,bottom line"),
  );
});

test("validateVerdictFormat rejects a non-strict verdict label", () => {
  const result = validateVerdictFormat({
    body: [
      "## [GD] Verdict: approve",
      "### TLDR",
      "",
      ...verdictBody().split("\n").filter((line) => !line.startsWith("## [GD]")),
    ].join("\n"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.problems.includes("verdict_label_invalid"));
});

test("validateVerdictFormat rejects TLDR placed after the details dropdown", () => {
  const result = validateVerdictFormat({
    body: [
      "## [GD] Verdict: approve-comment",
      "<details>",
      "<summary><b>Full verdict</b></summary>",
      "detail",
      "</details>",
      "### TLDR",
      "",
      verdictBody().split("\n").filter((line) => line.startsWith("- **")).join("\n"),
    ].join("\n"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.problems.includes("tldr_not_before_details"));
});

test("validateVerdictFormat accepts a template-compliant verdict", () => {
  const result = validateVerdictFormat({ body: verdictBody() });
  assert.equal(result.valid, true);
  assert.deepEqual(result.problems, []);
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
