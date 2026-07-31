#!/usr/bin/env node
/**
 * Paginate unresolved PR review threads via GraphQL.
 * Usage:
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER
 *   node scripts/review-threads.mjs OWNER/REPO PR_NUMBER --resolve PRRT_xxx
 * Requires: gh auth
 */
import { spawnSync } from "node:child_process";
import { parseReviewThreadArgs } from "./lib/review-policy.mjs";

let parsed;
try {
  parsed = parseReviewThreadArgs(process.argv.slice(2));
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}

const { repo, pr, resolveId } = parsed;
const [owner, name] = repo.split("/");

function ghJson(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    throw new Error(err || `gh failed (${r.status})`);
  }
  return JSON.parse(r.stdout || "null");
}

if (resolveId) {
  const mutation = `
    mutation($id: ID!) {
      resolveReviewThread(input: { threadId: $id }) {
        thread { id isResolved }
      }
    }`;
  const out = ghJson([
    "api",
    "graphql",
    "-f",
    `query=${mutation}`,
    "-F",
    `id=${resolveId}`,
  ]);
  if (out.errors?.length) {
    console.error(JSON.stringify(out.errors, null, 2));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(out.data, null, 2) + "\n");
  process.exit(0);
}

const query = `
  query($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        url
        reviewDecision
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 20) {
              nodes {
                id
                databaseId
                body
                author { login }
                createdAt
                url
              }
            }
          }
        }
      }
    }
  }`;

const threads = [];
let after = null;
let url = null;
let reviewDecision = null;
let pages = 0;

for (;;) {
  pages++;
  const vars = ["-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${pr}`];
  if (after) vars.push("-F", `after=${after}`);
  const out = ghJson(["api", "graphql", "-f", `query=${query}`, ...vars]);
  if (out.errors?.length) {
    console.error(JSON.stringify(out.errors, null, 2));
    process.exit(1);
  }
  const prNode = out.data?.repository?.pullRequest;
  if (!prNode) {
    console.error("PR not found");
    process.exit(1);
  }
  url = prNode.url;
  reviewDecision = prNode.reviewDecision;
  const conn = prNode.reviewThreads;
  for (const thread of conn.nodes || []) threads.push(thread);
  if (!conn.pageInfo?.hasNextPage) break;
  if (!conn.pageInfo.endCursor || pages >= 100) {
    console.error("Review thread pagination did not complete; refusing a partial result.");
    process.exit(2);
  }
  after = conn.pageInfo.endCursor;
}

const unresolved = threads.filter((thread) => thread.isResolved === false);
const useful = unresolved.map((thread) => {
  const comments = thread.comments?.nodes || [];
  const first = comments[0];
  const last = comments[comments.length - 1];
  return {
    threadId: thread.id,
    path: thread.path,
    line: thread.line,
    isOutdated: thread.isOutdated,
    author: first?.author?.login || null,
    preview: (first?.body || "").slice(0, 240),
    commentCount: comments.length,
    lastAuthor: last?.author?.login || null,
    replyHint: first?.databaseId
      ? `gh api repos/${owner}/${name}/pulls/${pr}/comments/${first.databaseId}/replies`
      : `graphql addPullRequestReviewThreadReply threadId=${thread.id}`,
  };
});

const out = {
  repo,
  pr,
  url,
  reviewDecision,
  complete: true,
  pages,
  totalThreads: threads.length,
  unresolvedCount: unresolved.length,
  unresolved: useful,
  note: "Address unresolved threads before merge-ready. Resolve only after verified fix (shared social policy). Use --resolve PRRT_… only when allowed.",
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exitCode = unresolved.length ? 1 : 0;
