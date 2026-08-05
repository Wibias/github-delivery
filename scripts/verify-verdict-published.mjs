#!/usr/bin/env node
/**
 * Verify one full-review run's verdict is actually published on the PR.
 * Exit 0 requires both a published verdict and a format-valid verdict body:
 * strict `## [GD] Verdict: <label>` heading, `### TLDR` with the required
 * bullets, and the full verdict inside a `<details>` dropdown.
 *
 * Same-head anti-noise (PR #1066): when this run did not post because a
 * completed same-head verdict already covers the draft with no material
 * delta, pass `--allow-same-head-reuse` and optionally `--body-file` with the
 * draft body. Exit 0 then reports `reused: true` against the existing
 * completed same-head comment.
 *
 * Usage:
 *   node scripts/verify-verdict-published.mjs OWNER/REPO PR_NUMBER \
 *     --run-id fr-... --head SHA [--comments-file FILE] [--mutation-mode MODE] \
 *     [--allow-same-head-reuse] [--body-file FILE]
 */
import { readFileSync } from "node:fs";

import {
  extractMutationModeArgs,
  normalizeMutationMode,
} from "./lib/mutation-policy.mjs";
import {
  fetchPrConversationComments,
  findVerdictPublication,
  planVerdictPublication,
  validateVerdictFormat,
} from "./lib/verdict-publication.mjs";

const usage =
  "Usage: node scripts/verify-verdict-published.mjs OWNER/REPO PR_NUMBER --run-id ID --head SHA [--comments-file FILE] [--mutation-mode MODE] [--allow-same-head-reuse] [--body-file FILE]";

function parseArgs(argv) {
  const positionals = [];
  let runId = null;
  let head = null;
  let commentsFile = null;
  let bodyFile = null;
  let allowSameHeadReuse = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--run-id") {
      runId = argv[++index];
      if (!runId) throw new Error("--run-id requires a value");
    } else if (value === "--head") {
      head = argv[++index];
      if (!head) throw new Error("--head requires a SHA");
    } else if (value === "--comments-file") {
      commentsFile = argv[++index];
      if (!commentsFile) throw new Error("--comments-file requires a path");
    } else if (value === "--body-file") {
      bodyFile = argv[++index];
      if (!bodyFile) throw new Error("--body-file requires a path");
    } else if (value === "--allow-same-head-reuse") {
      allowSameHeadReuse = true;
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      positionals.push(value);
    }
  }
  const [repo, prRaw] = positionals;
  const pr = Number(prRaw);
  if (
    positionals.length !== 2 ||
    !repo?.includes("/") ||
    !Number.isInteger(pr) ||
    pr <= 0
  ) {
    throw new Error(usage);
  }
  if (!runId || !head) throw new Error(usage);
  return { repo, pr, runId, head, commentsFile, bodyFile, allowSameHeadReuse };
}

try {
  const mutationArgs = extractMutationModeArgs(process.argv.slice(2));
  const args = parseArgs(mutationArgs.argv);
  const mode = normalizeMutationMode(mutationArgs.mode);
  const comments = args.commentsFile
    ? JSON.parse(readFileSync(args.commentsFile, "utf8"))
    : fetchPrConversationComments({ repo: args.repo, pr: args.pr });
  let verdict = findVerdictPublication({
    comments,
    runId: args.runId,
    head: args.head,
  });
  let reused = false;
  let reusePlan = null;
  if (!verdict && args.allowSameHeadReuse) {
    const draftBody = args.bodyFile
      ? readFileSync(args.bodyFile, "utf8")
      : null;
    if (draftBody) {
      reusePlan = planVerdictPublication({
        comments,
        runId: args.runId,
        head: args.head,
        body: draftBody,
      });
      if (
        reusePlan.action === "reuse_same_head" &&
        reusePlan.targetComment
      ) {
        verdict = reusePlan.targetComment;
        reused = true;
      }
    }
  }
  const format = verdict
    ? validateVerdictFormat({ body: verdict.body })
    : null;
  const output = {
    schemaVersion: 3,
    kind: "github-delivery/verdict-publication-check",
    published: Boolean(verdict),
    reused,
    format,
    repo: args.repo,
    pr: args.pr,
    runId: args.runId,
    head: args.head,
    mutationMode: mode,
    verdictCommentId: verdict?.id ?? null,
    url: verdict?.html_url ?? null,
    author: verdict?.user?.login ?? null,
    reusedFromRunId: reusePlan?.reusedFromRunId ?? null,
    planAction: reusePlan?.action ?? null,
    reason: verdict
      ? format?.valid
        ? reused
          ? "reused_same_head_verdict"
          : null
        : "verdict_format_invalid"
      : "verdict_not_published",
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = verdict && format?.valid ? 0 : 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
