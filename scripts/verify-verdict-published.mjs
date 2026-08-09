#!/usr/bin/env node
/**
 * Verify one full-review run's verdict is actually published on the PR by the
 * authenticated publisher.
 * Exit 0 requires both a trusted published verdict and a format-valid body:
 * strict `## [GD] Verdict: <label>` heading, `### TLDR` with the required
 * bullets, and the full verdict inside a `<details>` dropdown.
 *
 * Same-head anti-noise: when this run did not post because a completed
 * same-head verdict already covers the draft with no material delta, pass
 * `--allow-same-head-reuse` and optionally `--body-file` with the draft body.
 * Only verdicts owned by the authenticated publisher are eligible for reuse.
 *
 * `--publisher-login` is an offline-fixture override and is accepted only with
 * `--comments-file`. Live verification always resolves the authenticated actor
 * from `gh api user`.
 */
import { spawnSync } from "node:child_process";
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
  "Usage: node scripts/verify-verdict-published.mjs OWNER/REPO PR_NUMBER --run-id ID --head SHA [--comments-file FILE --publisher-login LOGIN] [--mutation-mode MODE] [--allow-same-head-reuse] [--body-file FILE]";

function parseArgs(argv) {
  const positionals = [];
  let runId = null;
  let head = null;
  let commentsFile = null;
  let publisherLogin = null;
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
    } else if (value === "--publisher-login") {
      publisherLogin = argv[++index];
      if (!publisherLogin) throw new Error("--publisher-login requires a login");
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
  if (publisherLogin && !commentsFile) {
    throw new Error("--publisher-login is allowed only with --comments-file");
  }
  if (commentsFile && !publisherLogin) {
    throw new Error("--comments-file requires --publisher-login for trusted provenance");
  }
  return {
    repo,
    pr,
    runId,
    head,
    commentsFile,
    publisherLogin,
    bodyFile,
    allowSameHeadReuse,
  };
}

function fetchAuthenticatedPublisher() {
  const result = spawnSync("gh", ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || "authenticated_publisher_unavailable");
  }
  const login = String(result.stdout || "").trim();
  if (!login) throw new Error("authenticated_publisher_missing");
  return login;
}

function commentsByPublisher(comments, publisherLogin) {
  return (comments || []).filter(
    (comment) => String(comment?.user?.login || "") === publisherLogin,
  );
}

try {
  const mutationArgs = extractMutationModeArgs(process.argv.slice(2));
  const args = parseArgs(mutationArgs.argv);
  const mode = normalizeMutationMode(mutationArgs.mode);
  const comments = args.commentsFile
    ? JSON.parse(readFileSync(args.commentsFile, "utf8"))
    : fetchPrConversationComments({ repo: args.repo, pr: args.pr });
  if (!Array.isArray(comments)) throw new Error("comments_payload_invalid");
  const expectedPublisher = args.commentsFile
    ? args.publisherLogin
    : fetchAuthenticatedPublisher();
  const trustedComments = commentsByPublisher(comments, expectedPublisher);
  const ignoredUntrustedComments = comments.length - trustedComments.length;

  let verdict = findVerdictPublication({
    comments: trustedComments,
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
        comments: trustedComments,
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
    schemaVersion: 4,
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
    expectedPublisher,
    ignoredUntrustedComments,
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
