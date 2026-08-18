#!/usr/bin/env node
/**
 * Verify one full-review run's verdict is actually published on the PR by the
 * authenticated publisher and satisfies the selected trusted-authority policy.
 * In `high-assurance` and `all` modes, live verification requires an authority
 * grant that was valid for the exact comment scope when published. In `off`
 * mode, publication/format/ownership checks remain mandatory but OS-backed
 * provenance is intentionally not required.
 *
 * Same-head anti-noise: when this run did not post because a completed
 * same-head verdict already covers the draft with no material delta, pass
 * `--allow-same-head-reuse` and optionally `--body-file` with the draft body.
 * Only verdicts owned by the authenticated publisher are eligible for reuse.
 *
 * `--comments-file` is an offline fixture mode. Existing format/publication
 * fixtures may omit authority material; provenance is then explicitly marked
 * unchecked and `trusted:false`. Security/provenance fixtures can opt into the
 * real verifier with `--authority-public-key-file`; those fixtures stay strict
 * regardless of the user's local authority mode.
 */
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { readFileSync } from "node:fs";

import {
  extractMutationModeArgs,
  normalizeMutationMode,
} from "./lib/mutation-policy.mjs";
import { authorityVerifierConfiguration } from "./lib/mutation-execution-context.mjs";
import { verifyReviewVerdictProvenance } from "./lib/review-verdict-provenance.mjs";
import { verdictAuthorityPolicy } from "./lib/verdict-authority-policy.mjs";
import {
  fetchPrConversationComments,
  findVerdictPublication,
  planVerdictPublication,
  validateVerdictFormat,
} from "./lib/verdict-publication.mjs";

const usage =
  "Usage: node scripts/verify-verdict-published.mjs OWNER/REPO PR_NUMBER --run-id ID --head SHA [--comments-file FILE [--publisher-login LOGIN] [--authority-public-key-file FILE]] [--mutation-mode MODE] [--allow-same-head-reuse] [--body-file FILE]";

function parseArgs(argv) {
  const positionals = [];
  let runId = null;
  let head = null;
  let commentsFile = null;
  let publisherLogin = null;
  let authorityPublicKeyFile = null;
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
    } else if (value === "--authority-public-key-file") {
      authorityPublicKeyFile = argv[++index];
      if (!authorityPublicKeyFile) throw new Error("--authority-public-key-file requires a path");
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
  if ((publisherLogin || authorityPublicKeyFile) && !commentsFile) {
    throw new Error(
      "--publisher-login and --authority-public-key-file are allowed only with --comments-file",
    );
  }
  return {
    repo,
    pr,
    runId,
    head,
    commentsFile,
    publisherLogin,
    authorityPublicKeyFile,
    bodyFile,
    allowSameHeadReuse,
  };
}

function fetchAuthenticatedPublisher() {
  const result = boundedSpawnSync("gh", ["api", "user", "--jq", ".login"], {
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

function inferOfflinePublisher(comments) {
  const login = String(comments?.find((comment) => comment?.user?.login)?.user?.login || "").trim();
  if (!login) throw new Error("offline_publisher_missing");
  return login;
}

try {
  const mutationArgs = extractMutationModeArgs(process.argv.slice(2));
  const args = parseArgs(mutationArgs.argv);
  const mode = normalizeMutationMode(mutationArgs.mode);
  const offlineFixture = Boolean(args.commentsFile);
  const authorityPolicy = verdictAuthorityPolicy({
    offlineFixture,
    authorityPublicKeyFile: args.authorityPublicKeyFile,
  });
  const enforceProvenance = authorityPolicy.enforceProvenance;
  const comments = offlineFixture
    ? JSON.parse(readFileSync(args.commentsFile, "utf8"))
    : fetchPrConversationComments({ repo: args.repo, pr: args.pr });
  if (!Array.isArray(comments)) throw new Error("comments_payload_invalid");
  const expectedPublisher = offlineFixture
    ? args.publisherLogin || inferOfflinePublisher(comments)
    : fetchAuthenticatedPublisher();
  const authorityVerifier = enforceProvenance
    ? offlineFixture
      ? readFileSync(args.authorityPublicKeyFile, "utf8")
      : authorityVerifierConfiguration()
    : null;
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
  const provenance = verdict && enforceProvenance && authorityVerifier
    ? verifyReviewVerdictProvenance({
        comment: verdict,
        repo: args.repo,
        pr: args.pr,
        head: args.head,
        authorityVerifier,
      })
    : verdict && enforceProvenance
      ? { valid: false, reason: "review_authority_verifier_missing" }
      : verdict
        ? {
            valid: true,
            trusted: false,
            offlineFixture,
            authorityMode: authorityPolicy.authorityMode,
            reason: authorityPolicy.reason,
          }
        : null;
  const complete = Boolean(verdict) && format?.valid === true && provenance?.valid === true;
  const trusted = provenance?.valid === true && provenance?.authority?.verified === true;
  const output = {
    schemaVersion: 5,
    kind: "github-delivery/verdict-publication-check",
    published: Boolean(verdict),
    trusted,
    reused,
    format,
    provenance,
    authorityMode: authorityPolicy.authorityMode,
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
    reason: !verdict
      ? "verdict_not_published"
      : !format?.valid
        ? "verdict_format_invalid"
        : !provenance?.valid
          ? provenance?.reason || "verdict_authority_invalid"
          : reused
            ? "reused_same_head_verdict"
            : null,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = complete ? 0 : 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
