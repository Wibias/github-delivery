#!/usr/bin/env node
/**
 * Block idle/waiting while trusted feedback or base-state work remains.
 * Usage: node scripts/watch-wake-gate.mjs OWNER/REPO PR_NUMBER
 *
 * Exit 0: waiting is allowed
 * Exit 1: known work remains
 * Exit 2: evidence is incomplete or the command failed
 */
import { spawnSync } from "node:child_process";
import { collectPaginated } from "./lib/github-pagination.mjs";
import {
  findUnaddressedFeedback,
  normalizeFeedback,
} from "./lib/watch-feedback.mjs";

const [repo, prRaw] = process.argv.slice(2);
const pr = Number(prRaw);
if (!repo || !repo.includes("/") || !Number.isInteger(pr) || pr <= 0) {
  console.error("Usage: node scripts/watch-wake-gate.mjs OWNER/REPO PR_NUMBER");
  process.exit(2);
}
const [owner, name] = repo.split("/");
const DIRTY_STATES = new Set(["DIRTY", "CONFLICTING", "BEHIND"]);

function ghOk(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    body: result.stdout || "",
    error: (result.stderr || result.stdout || "").trim() || null,
  };
}

function ghJson(args) {
  const result = ghOk(args);
  if (!result.ok) throw new Error(result.error || "gh failed");
  return JSON.parse(result.body || "null");
}

function fetchCollection(path, label) {
  return collectPaginated({
    label,
    fetchPage(page) {
      return ghOk([
        "api",
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      ]);
    },
  });
}

try {
  const meta = ghJson([
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "url,headRefOid,commits,mergeStateStatus,mergeable,baseRefName",
  ]);
  const loginResult = ghOk(["api", "user", "--jq", ".login"]);
  const myLogin = loginResult.ok ? loginResult.body.trim() : null;

  const issueComments = fetchCollection(
    `repos/${owner}/${name}/issues/${pr}/comments`,
    "issue comments",
  );
  const reviewComments = fetchCollection(
    `repos/${owner}/${name}/pulls/${pr}/comments`,
    "review comments",
  );
  const reviews = fetchCollection(
    `repos/${owner}/${name}/pulls/${pr}/reviews`,
    "review submissions",
  );

  const commits = (meta.commits || []).map((commit) => ({
    oid: commit.oid || commit.commit?.oid,
    message: String(
      commit.messageHeadline || commit.commit?.messageHeadline || "",
    ).trim(),
    authoredDate:
      commit.committedDate ||
      commit.commit?.authoredDate ||
      commit.authoredDate ||
      null,
  }));

  const feedback = [
    ...issueComments.rows.map((row) =>
      normalizeFeedback(row, "issue_comment"),
    ),
    ...reviewComments.rows.map((row) =>
      normalizeFeedback(row, "review_comment"),
    ),
    ...reviews.rows.map((row) =>
      normalizeFeedback(row, "review_submission"),
    ),
  ];
  const unaddressed = findUnaddressedFeedback({
    feedback,
    commits,
    myLogin,
  });

  const blockers = [];
  const mergeState = meta.mergeStateStatus || "";
  if (DIRTY_STATES.has(mergeState) || meta.mergeable === "CONFLICTING") {
    blockers.push({
      key: "base-state",
      kind: "merge_state",
      url: meta.url,
      reason: "base_dirty_or_behind",
      excerpt: `mergeStateStatus=${mergeState} mergeable=${meta.mergeable}`,
      howToClear: `Update from base ${meta.baseRefName || "base"} and resolve conflicts before waiting.`,
    });
  }

  for (const comment of unaddressed) {
    blockers.push({
      key: comment.key,
      id: comment.id,
      kind: comment.kind,
      author: comment.login,
      association: comment.association,
      createdAt: comment.createdAt,
      url: comment.url,
      path: comment.path,
      line: comment.line,
      excerpt: comment.body.replace(/\s+/g, " ").slice(0, 220),
      reason: "trusted_human_feedback_needs_code",
      howToClear:
        "Address the feedback in a later non-merge commit. An acknowledgement comment alone does not clear the gate.",
    });
  }

  const sources = {
    issueCommentsReadable: issueComments.readable,
    issueCommentsComplete: issueComments.complete,
    issueCommentsPages: issueComments.pages,
    issueCommentsError: issueComments.error,
    reviewCommentsReadable: reviewComments.readable,
    reviewCommentsComplete: reviewComments.complete,
    reviewCommentsPages: reviewComments.pages,
    reviewCommentsError: reviewComments.error,
    reviewsReadable: reviews.readable,
    reviewsComplete: reviews.complete,
    reviewsPages: reviews.pages,
    reviewsError: reviews.error,
  };
  const complete =
    issueComments.complete && reviewComments.complete && reviews.complete;
  if (!complete) {
    blockers.push({
      key: "feedback-data",
      kind: "evidence",
      url: meta.url,
      reason: "feedback_data_incomplete",
      excerpt: "One or more feedback sources could not be read completely.",
      howToClear: "Restore API access and rerun the wake gate.",
    });
  }

  const output = {
    schemaVersion: 1,
    repo,
    pr,
    url: meta.url,
    headRefOid: meta.headRefOid,
    mergeStateStatus: meta.mergeStateStatus,
    mergeable: meta.mergeable,
    complete,
    canWait: complete && blockers.length === 0,
    blockerCount: blockers.length,
    blockers,
    feedbackCount: feedback.length,
    sources,
    note:
      complete && blockers.length === 0
        ? "Wake gate clear: CI or bot waiting is allowed."
        : "Do not report waiting while feedback, base-state, or evidence blockers remain.",
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = !complete ? 2 : blockers.length ? 1 : 0;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
