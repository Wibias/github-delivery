#!/usr/bin/env node
/**
 * Verify one full-review run's verdict is actually published on the PR.
 * Usage:
 *   node scripts/verify-verdict-published.mjs OWNER/REPO PR_NUMBER \
 *     --run-id fr-... --head SHA [--comments-file FILE] [--mutation-mode MODE]
 */
import { readFileSync } from "node:fs";

import {
  extractMutationModeArgs,
  normalizeMutationMode,
} from "./lib/mutation-policy.mjs";
import {
  fetchPrConversationComments,
  findVerdictPublication,
} from "./lib/verdict-publication.mjs";

const usage =
  "Usage: node scripts/verify-verdict-published.mjs OWNER/REPO PR_NUMBER --run-id ID --head SHA [--comments-file FILE] [--mutation-mode MODE]";

function parseArgs(argv) {
  const positionals = [];
  let runId = null;
  let head = null;
  let commentsFile = null;
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
  return { repo, pr, runId, head, commentsFile };
}

try {
  const mutationArgs = extractMutationModeArgs(process.argv.slice(2));
  const args = parseArgs(mutationArgs.argv);
  const mode = normalizeMutationMode(mutationArgs.mode);
  const comments = args.commentsFile
    ? JSON.parse(readFileSync(args.commentsFile, "utf8"))
    : fetchPrConversationComments({ repo: args.repo, pr: args.pr });
  const verdict = findVerdictPublication({
    comments,
    runId: args.runId,
    head: args.head,
  });
  const output = {
    schemaVersion: 1,
    kind: "github-delivery/verdict-publication-check",
    published: Boolean(verdict),
    repo: args.repo,
    pr: args.pr,
    runId: args.runId,
    head: args.head,
    mutationMode: mode,
    verdictCommentId: verdict?.id ?? null,
    url: verdict?.html_url ?? null,
    author: verdict?.user?.login ?? null,
    reason: verdict ? null : "verdict_not_published",
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = verdict ? 0 : 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
