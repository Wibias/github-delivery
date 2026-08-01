#!/usr/bin/env node
/**
 * Capture one timestamped GitHub evidence snapshot for a pull request.
 * Usage: node scripts/ship-gate-snapshot.mjs OWNER/REPO PR_NUMBER [--output FILE]
 * Requires: gh auth
 */
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { collectPaginated } from "./lib/github-pagination.mjs";
import { createSnapshotEnvelope } from "./lib/snapshot-schema.mjs";

function parseArgs(argv) {
  const positionals = [];
  let output = null;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[++index];
      if (!output) throw new Error("--output requires a file path");
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
    throw new Error(
      "Usage: node scripts/ship-gate-snapshot.mjs OWNER/REPO PR_NUMBER [--output FILE]",
    );
  }
  return { repo, pr, output };
}

function ghOk(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
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
  try {
    return JSON.parse(result.body || "null");
  } catch {
    throw new Error(`gh returned invalid JSON: ${args.join(" ")}`);
  }
}

function restCollection(path, label, unwrap = (payload) => payload) {
  return collectPaginated({
    label,
    unwrap,
    fetchPage(page) {
      return ghOk([
        "api",
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      ]);
    },
  });
}

function reviewThreads(owner, name, pr) {
  const rows = [];
  let after = null;
  for (let page = 1; page <= 100; page++) {
    const query = `
      query($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                isOutdated
                path
                line
                comments(first: 100) {
                  pageInfo { hasNextPage }
                  nodes {
                    id
                    databaseId
                    body
                    createdAt
                    url
                    author { login }
                    authorAssociation
                  }
                }
              }
            }
          }
        }
      }`;
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${pr}`,
    ];
    if (after) args.push("-F", `after=${after}`);
    const response = ghOk(args);
    if (!response.ok) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: response.error || "review threads request failed",
      };
    }
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: "review threads returned invalid JSON",
      };
    }
    if (payload.errors?.length) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: JSON.stringify(payload.errors),
      };
    }
    const connection = payload.data?.repository?.pullRequest?.reviewThreads;
    if (!connection) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: "review threads returned an unexpected payload",
      };
    }
    rows.push(...(connection.nodes || []));
    if (
      (connection.nodes || []).some(
        (thread) => thread.comments?.pageInfo?.hasNextPage === true,
      )
    ) {
      return {
        readable: true,
        complete: false,
        pages: page,
        rows,
        error: "a review thread contains more than 100 comments",
      };
    }
    if (!connection.pageInfo?.hasNextPage) {
      return { readable: true, complete: true, pages: page, rows, error: null };
    }
    after = connection.pageInfo?.endCursor;
    if (!after) {
      return {
        readable: true,
        complete: false,
        pages: page,
        rows,
        error: "review thread pagination cursor missing",
      };
    }
  }
  return {
    readable: true,
    complete: false,
    pages: 100,
    rows,
    error: "review threads exceeded pagination safety limit",
  };
}

function fetchCodeowners(owner, name, ref) {
  for (const path of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
    const response = ghOk([
      "api",
      `repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    ]);
    if (!response.ok) continue;
    try {
      const payload = JSON.parse(response.body);
      if (payload?.content) {
        return {
          readable: true,
          complete: true,
          path,
          text: Buffer.from(payload.content, "base64").toString("utf8"),
          error: null,
        };
      }
    } catch {
      return {
        readable: false,
        complete: false,
        path,
        text: null,
        error: "CODEOWNERS returned invalid JSON",
      };
    }
  }
  return {
    readable: true,
    complete: true,
    path: null,
    text: null,
    error: null,
  };
}

try {
  const { repo, pr, output } = parseArgs(process.argv.slice(2));
  const [owner, name] = repo.split("/");
  const capturedAt = new Date().toISOString();

  const prEvidence = ghJson([
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "number,title,state,isDraft,url,baseRefName,headRefOid,mergeStateStatus,mergeable,reviewDecision,reviewRequests,commits",
  ]);
  const base = prEvidence.baseRefName;
  const headOid = prEvidence.headRefOid;

  const changedFiles = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/files`,
    "changed files",
  );
  const activeRules = restCollection(
    `repos/${owner}/${name}/rules/branches/${encodeURIComponent(base)}`,
    "active rules",
  );
  const checkRuns = restCollection(
    `repos/${owner}/${name}/commits/${headOid}/check-runs`,
    "check runs",
    (payload) => payload?.check_runs,
  );
  const statuses = restCollection(
    `repos/${owner}/${name}/commits/${headOid}/statuses`,
    "commit statuses",
  );
  const issueComments = restCollection(
    `repos/${owner}/${name}/issues/${pr}/comments`,
    "issue comments",
  );
  const reviewComments = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/comments`,
    "review comments",
  );
  const reviews = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/reviews`,
    "review submissions",
  );
  const threads = reviewThreads(owner, name, pr);

  const protectionResponse = ghOk([
    "api",
    `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
  ]);
  let branchProtection = null;
  let branchProtectionError = protectionResponse.error;
  if (protectionResponse.ok) {
    try {
      branchProtection = JSON.parse(protectionResponse.body);
      branchProtectionError = null;
    } catch {
      branchProtectionError = "branch protection returned invalid JSON";
    }
  }
  const codeowners = fetchCodeowners(owner, name, base);

  const sources = {
    pr: { required: true, readable: true, complete: true, error: null },
    changedFiles: {
      required: true,
      readable: changedFiles.readable,
      complete: changedFiles.complete,
      pages: changedFiles.pages,
      error: changedFiles.error,
    },
    activeRules: {
      required: true,
      readable: activeRules.readable,
      complete: activeRules.complete,
      pages: activeRules.pages,
      error: activeRules.error,
    },
    checkRuns: {
      required: true,
      readable: checkRuns.readable,
      complete: checkRuns.complete,
      pages: checkRuns.pages,
      error: checkRuns.error,
    },
    statuses: {
      required: true,
      readable: statuses.readable,
      complete: statuses.complete,
      pages: statuses.pages,
      error: statuses.error,
    },
    issueComments: {
      required: true,
      readable: issueComments.readable,
      complete: issueComments.complete,
      pages: issueComments.pages,
      error: issueComments.error,
    },
    reviewComments: {
      required: true,
      readable: reviewComments.readable,
      complete: reviewComments.complete,
      pages: reviewComments.pages,
      error: reviewComments.error,
    },
    reviews: {
      required: true,
      readable: reviews.readable,
      complete: reviews.complete,
      pages: reviews.pages,
      error: reviews.error,
    },
    reviewThreads: {
      required: true,
      readable: threads.readable,
      complete: threads.complete,
      pages: threads.pages,
      error: threads.error,
    },
    branchProtection: {
      required: false,
      readable: protectionResponse.ok,
      complete: protectionResponse.ok || branchProtection === null,
      error: branchProtectionError,
    },
    codeowners: {
      required: false,
      readable: codeowners.readable,
      complete: codeowners.complete,
      error: codeowners.error,
    },
  };

  const snapshot = createSnapshotEnvelope({
    repo,
    pr,
    headOid,
    capturedAt,
    sources,
    evidence: {
      pullRequest: prEvidence,
      changedFiles: changedFiles.rows,
      branchProtection,
      activeRules: activeRules.rows,
      checks: {
        checkRuns: checkRuns.rows,
        statuses: statuses.rows,
      },
      feedback: {
        issueComments: issueComments.rows,
        reviewComments: reviewComments.rows,
        reviews: reviews.rows,
        reviewThreads: threads.rows,
      },
      codeowners: {
        path: codeowners.path,
        text: codeowners.text,
      },
    },
  });

  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (output) writeFileSync(output, json, "utf8");
  process.stdout.write(json);
  process.exitCode = snapshot.complete ? 0 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
