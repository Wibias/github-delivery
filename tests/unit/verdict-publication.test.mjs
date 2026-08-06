import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assessVerdictFreshness,
  findVerdictPublication,
  materialVerdictDelta,
  planVerdictPublication,
  validateVerdictFormat,
} from "../../scripts/lib/verdict-publication.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const COMMAND = join(ROOT, "scripts", "verify-verdict-published.mjs");
const RUN_ID = "fr-42-abc123-20260804";
const RUN_ID_2 = "fr-42-abc123-20260804T203000Z";
const HEAD = "0123456789abcdef0123456789abcdef01234567";
const OTHER_HEAD = "ffffffffffffffffffffffffffffffffffffffff";

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

function writeBody(body) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-verdict-body-"));
  const path = join(directory, "body.md");
  writeFileSync(path, body, "utf8");
  return path;
}

function verdictBody({
  runId = RUN_ID,
  head = HEAD,
  label = "approve-comment",
  decision = "useful and ready",
  bottomLine = "ship it",
} = {}) {
  const bullets = [
    "**PR:** `#42` — widget",
    "**Head:** `abc1234` on `dev`",
    `**Decision:** ${decision}`,
    "**Usefulness:** fixes a real bug",
    "**Bugs:** none blocking",
    "**Security:** none",
    "**Spec / standards:** clean",
    "**Reviews:** humans + bots clear",
    "**Base / CI:** green",
    "**Gate:** none",
    "**Owner actions (foreign PR):** none",
    `**Bottom line:** ${bottomLine}`,
  ]
    .map((line) => `- ${line}`)
    .join("\n");
  return [
    `## [GD] Verdict: ${label}`,
    `<!-- github-delivery:full-review-verdict run:${runId} head:${head} -->`,
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
      `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${OTHER_HEAD} -->`,
    ),
  ];
  assert.equal(
    findVerdictPublication({ comments, runId: RUN_ID, head: HEAD }),
    null,
  );
});

test("materialVerdictDelta is empty for wording-only details changes", () => {
  const previous = verdictBody({ decision: "useful and ready" });
  const next = previous.replace(
    "full detail here",
    "full detail here with extra wording that stays in details only",
  );
  const delta = materialVerdictDelta({ previousBody: previous, nextBody: next });
  assert.equal(delta.material, false);
  assert.deepEqual(delta.reasons, []);
});

test("materialVerdictDelta flags label or TLDR bullet changes", () => {
  const previous = verdictBody({ label: "gated", decision: "blocked" });
  const nextLabel = verdictBody({ label: "approve-comment", decision: "blocked" });
  const nextDecision = verdictBody({ label: "gated", decision: "still blocked" });
  assert.equal(
    materialVerdictDelta({ previousBody: previous, nextBody: nextLabel }).material,
    true,
  );
  assert.ok(
    materialVerdictDelta({
      previousBody: previous,
      nextBody: nextLabel,
    }).reasons.includes("verdict_label_changed"),
  );
  assert.ok(
    materialVerdictDelta({
      previousBody: previous,
      nextBody: nextDecision,
    }).reasons.includes("tldr_changed:decision"),
  );
});

test("planVerdictPublication reuses completed same-head verdict without material delta", () => {
  const existing = comment(verdictBody({ runId: RUN_ID, head: HEAD }), 100);
  const draft = verdictBody({ runId: RUN_ID_2, head: HEAD });
  const plan = planVerdictPublication({
    comments: [existing],
    runId: RUN_ID_2,
    head: HEAD,
    body: draft,
  });
  assert.equal(plan.action, "reuse_same_head");
  assert.equal(plan.reason, "same_head_no_material_delta");
  assert.equal(plan.targetComment.id, 100);
  assert.equal(plan.reusedFromRunId, RUN_ID);
});

test("planVerdictPublication posts new when same-head material delta exists", () => {
  const existing = comment(
    verdictBody({ runId: RUN_ID, head: HEAD, label: "gated", decision: "blocked" }),
    100,
  );
  const draft = verdictBody({
    runId: RUN_ID_2,
    head: HEAD,
    label: "approve-comment",
    decision: "ready after fixes",
  });
  const plan = planVerdictPublication({
    comments: [existing],
    runId: RUN_ID_2,
    head: HEAD,
    body: draft,
  });
  assert.equal(plan.action, "post_new");
  assert.equal(plan.reason, "same_head_material_delta");
});

test("planVerdictPublication posts new for a different head", () => {
  const existing = comment(verdictBody({ runId: RUN_ID, head: HEAD }), 100);
  const draft = verdictBody({ runId: RUN_ID_2, head: OTHER_HEAD });
  const plan = planVerdictPublication({
    comments: [existing],
    runId: RUN_ID_2,
    head: OTHER_HEAD,
    body: draft,
  });
  assert.equal(plan.action, "post_new");
  assert.equal(plan.reason, "no_existing_verdict");
});

test("planVerdictPublication repairs incomplete current-run publication", () => {
  const incomplete = comment(
    `## [GD] Verdict: gated\n<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${HEAD} -->\n### Verdict\nbroken`,
    55,
  );
  const plan = planVerdictPublication({
    comments: [incomplete],
    runId: RUN_ID,
    head: HEAD,
    body: verdictBody(),
  });
  assert.equal(plan.action, "edit_current_run");
  assert.equal(plan.targetComment.id, 55);
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
  assert.equal(output.reused, false);
  assert.equal(output.format.valid, true);
  assert.deepEqual(output.format.problems, []);
  assert.equal(output.reason, null);
  assert.equal(output.verdictCommentId, 123);
  assert.equal(output.author, "Wibias");
  assert.equal(output.mutationMode, "review");
});

test("verify CLI can accept same-head reuse when draft has no material delta", () => {
  const existingBody = verdictBody({ runId: RUN_ID, head: HEAD });
  const draftBody = verdictBody({ runId: RUN_ID_2, head: HEAD });
  const commentsFile = writeComments([comment(existingBody, 777)]);
  const bodyFile = writeBody(draftBody);
  const result = run([
    "acme/widget",
    "42",
    "--run-id",
    RUN_ID_2,
    "--head",
    HEAD,
    "--comments-file",
    commentsFile,
    "--allow-same-head-reuse",
    "--body-file",
    bodyFile,
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.published, true);
  assert.equal(output.reused, true);
  assert.equal(output.reason, "reused_same_head_verdict");
  assert.equal(output.verdictCommentId, 777);
  assert.equal(output.reusedFromRunId, RUN_ID);
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
      `<!-- github-delivery:full-review-verdict run:${RUN_ID} head:${OTHER_HEAD} -->`,
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

function botThread({ id, author = "coderabbitai[bot]", createdAt = "2026-08-06T10:00:00Z", resolved = false, outdated = false }) {
  return {
    id,
    isResolved: resolved,
    isOutdated: outdated,
    path: "gui/src/pages/RoutingProfiles.tsx",
    line: 416,
    comments: {
      nodes: [
        {
          id: `${id}-c1`,
          author: { login: author },
          body: "Actionable bot finding.",
          createdAt,
        },
      ],
    },
  };
}

test("freshness flags unresolved non-outdated bot threads on the reviewed head", () => {
  const result = assessVerdictFreshness({
    threads: [botThread({ id: "T1" })],
    headOid: HEAD,
    reviewedHead: HEAD,
  });
  assert.equal(result.stale, true);
  assert.equal(result.reason, "new_actionable_bot_threads_on_head");
  assert.equal(result.actionable.length, 1);
  assert.equal(result.actionable[0].author, "coderabbitai[bot]");
});

test("freshness ignores resolved and outdated threads", () => {
  const result = assessVerdictFreshness({
    threads: [
      botThread({ id: "T1", resolved: true }),
      botThread({ id: "T2", outdated: true }),
    ],
    headOid: HEAD,
    reviewedHead: HEAD,
  });
  assert.equal(result.stale, false);
  assert.equal(result.actionable.length, 0);
});

test("freshness ignores human-authored threads", () => {
  const result = assessVerdictFreshness({
    threads: [botThread({ id: "T1", author: "Ingwannu" })],
    headOid: HEAD,
    reviewedHead: HEAD,
  });
  assert.equal(result.stale, false);
  assert.equal(result.actionable.length, 0);
});

test("freshness honors an evidence cutoff (threads newer than evidence are stale)", () => {
  const result = assessVerdictFreshness({
    threads: [botThread({ id: "T1", createdAt: "2026-08-06T12:00:00Z" })],
    headOid: HEAD,
    reviewedHead: HEAD,
    evidenceCutoff: "2026-08-06T11:00:00Z",
  });
  assert.equal(result.stale, true);
});

test("freshness passes when bot threads predate the evidence cutoff", () => {
  const result = assessVerdictFreshness({
    threads: [botThread({ id: "T1", createdAt: "2026-08-06T10:00:00Z" })],
    headOid: HEAD,
    reviewedHead: HEAD,
    evidenceCutoff: "2026-08-06T11:00:00Z",
  });
  assert.equal(result.stale, false);
});

test("freshness refuses when the reviewed head is missing", () => {
  const result = assessVerdictFreshness({ threads: [], headOid: null, reviewedHead: null });
  assert.equal(result.stale, true);
  assert.equal(result.reason, "reviewed_head_missing");
});
