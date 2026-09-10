#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import {
  fetchPrConversationComments,
  findVerdictPublication,
} from "./lib/verdict-publication.mjs";
import { verifyReviewVerdictCompletion } from "./lib/review-verdict-completion.mjs";

const usage = "Usage: node scripts/verify-review-verdict-completion.mjs OWNER/REPO PR_NUMBER --run-id ID --head SHA [--mutation-mode MODE] [--workflow PATH] [--comments-file FILE --reviews-file FILE --ship-gate-file FILE --viewer-login LOGIN]";

function parseArgs(argv) {
  const positionals = [];
  const args = {
    runId: null,
    head: null,
    mutationMode: "review",
    workflow: "references/re-review-pr.md",
    commentsFile: null,
    reviewsFile: null,
    shipGateFile: null,
    viewerLogin: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = () => {
      const result = argv[++index];
      if (!result) throw new Error(`${value} requires a value`);
      return result;
    };
    if (value === "--run-id") args.runId = next();
    else if (value === "--head") args.head = next();
    else if (value === "--mutation-mode") args.mutationMode = next();
    else if (value === "--workflow") args.workflow = next();
    else if (value === "--comments-file") args.commentsFile = next();
    else if (value === "--reviews-file") args.reviewsFile = next();
    else if (value === "--ship-gate-file") args.shipGateFile = next();
    else if (value === "--viewer-login") args.viewerLogin = next();
    else if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    else positionals.push(value);
  }
  const [repo, prRaw] = positionals;
  const pr = Number(prRaw);
  if (positionals.length !== 2 || !repo?.includes("/") || !Number.isInteger(pr) || pr <= 0 || !args.runId || !args.head) {
    throw new Error(usage);
  }
  const offline = Boolean(args.commentsFile || args.reviewsFile || args.shipGateFile || args.viewerLogin);
  if (offline && !(args.commentsFile && args.reviewsFile && args.shipGateFile && args.viewerLogin)) {
    throw new Error("offline fixture mode requires --comments-file, --reviews-file, --ship-gate-file, and --viewer-login together");
  }
  return { repo, pr, ...args, offline };
}

function run(command, args, options = {}) {
  const result = boundedSpawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  return result;
}

function requireJson(result, label, acceptedStatuses = [0]) {
  if (!acceptedStatuses.includes(result.status)) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${label}_failed${detail ? `:${detail}` : ""}`);
  }
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    throw new Error(`${label}_json_invalid`);
  }
}

function fetchViewerLogin() {
  const result = run("gh", ["api", "user", "--jq", ".login"], { maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error("authenticated_viewer_unavailable");
  const login = String(result.stdout || "").trim();
  if (!login) throw new Error("authenticated_viewer_missing");
  return login;
}

function fetchReviews(repo, pr) {
  const reviews = [];
  for (let page = 1; ; page += 1) {
    const result = run("gh", ["api", `repos/${repo}/pulls/${pr}/reviews?per_page=100&page=${page}`]);
    const batch = requireJson(result, "reviews_fetch");
    if (!Array.isArray(batch)) throw new Error("reviews_payload_invalid");
    reviews.push(...batch);
    if (batch.length < 100) return reviews;
  }
}

function fetchShipGate({ repo, pr, head, mutationMode, workflow }) {
  const command = join(import.meta.dirname, "ship-gate.mjs");
  const result = run(process.execPath, [command, repo, String(pr), "--expected-head", head, "--mutation-mode", mutationMode, "--workflow", workflow]);
  return requireJson(result, "ship_gate", [0, 1, 2]);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const comments = args.offline
    ? JSON.parse(readFileSync(args.commentsFile, "utf8"))
    : fetchPrConversationComments({ repo: args.repo, pr: args.pr });
  const reviews = args.offline
    ? JSON.parse(readFileSync(args.reviewsFile, "utf8"))
    : fetchReviews(args.repo, args.pr);
  const shipGate = args.offline
    ? JSON.parse(readFileSync(args.shipGateFile, "utf8"))
    : fetchShipGate(args);
  const viewerLogin = args.offline ? args.viewerLogin : fetchViewerLogin();

  const verdict = findVerdictPublication({
    comments,
    runId: args.runId,
    head: args.head,
  });
  if (!verdict) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, kind: "github-delivery/review-verdict-completion", complete: false, problems: ["verdict_not_published"], repo: args.repo, pr: args.pr, runId: args.runId, head: args.head }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const verification = verifyReviewVerdictCompletion({
      body: verdict.body,
      reviews,
      viewerLogin,
      shipGate,
    });
    const output = {
      schemaVersion: 1,
      kind: "github-delivery/review-verdict-completion",
      complete: verification.valid,
      ...verification,
      repo: args.repo,
      pr: args.pr,
      runId: args.runId,
      head: args.head,
      verdictCommentId: verdict.id ?? null,
      viewerLogin,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = output.complete ? 0 : 1;
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
