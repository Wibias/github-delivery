#!/usr/bin/env node
/**
 * Capture one timestamped GitHub evidence snapshot for a pull request.
 * Usage: node scripts/ship-gate-snapshot.mjs OWNER/REPO PR_NUMBER [--output FILE]
 * Requires: gh auth
 */
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { assembleSnapshotCapture } from "./lib/snapshot-capture-payload.mjs";
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

function isNotFound(error) {
  return /(?:HTTP\s+404|Not Found)/i.test(String(error || ""));
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
  let source = {
    readable: true,
    complete: true,
    path: null,
    text: null,
    error: null,
  };
  for (const path of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
    const response = ghOk([
      "api",
      `repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    ]);
    if (!response.ok) {
      if (isNotFound(response.error)) continue;
      source = {
        readable: false,
        complete: false,
        path,
        text: null,
        error: response.error || "CODEOWNERS request failed",
      };
      break;
    }
    try {
      const payload = JSON.parse(response.body);
      if (payload?.content) {
        source = {
          readable: true,
          complete: true,
          path,
          text: Buffer.from(payload.content, "base64").toString("utf8"),
          error: null,
        };
        break;
      }
    } catch {
      source = {
        readable: false,
        complete: false,
        path,
        text: null,
        error: "CODEOWNERS returned invalid JSON",
      };
      break;
    }
  }

  const errorsResponse = ghOk([
    "api",
    `repos/${owner}/${name}/codeowners/errors?ref=${encodeURIComponent(ref)}`,
  ]);
  if (errorsResponse.ok) {
    try {
      source.errors = JSON.parse(errorsResponse.body)?.errors || [];
      source.errorsReadable = true;
      source.errorsComplete = true;
      source.errorsError = null;
    } catch {
      source.errors = [];
      source.errorsReadable = false;
      source.errorsComplete = false;
      source.errorsError = "CODEOWNERS errors returned invalid JSON";
    }
  } else if (isNotFound(errorsResponse.error)) {
    source.errors = [];
    source.errorsReadable = true;
    source.errorsComplete = true;
    source.errorsError = null;
  } else {
    source.errors = [];
    source.errorsReadable = false;
    source.errorsComplete = false;
    source.errorsError = errorsResponse.error || "CODEOWNERS errors request failed";
  }
  return source;
}

function fetchPolicy(owner, name, pr) {
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        branchProtectionRules(first: 100) {
          pageInfo { hasNextPage }
          nodes { pattern }
        }
        pullRequest(number: $number) {
          isInMergeQueue
          isMergeQueueEnabled
          mergeQueueEntry {
            position
            state
            enqueuedAt
            estimatedTimeToMerge
          }
          latestOpinionatedReviews(first: 100) {
            pageInfo { hasNextPage }
            nodes {
              author { login }
              state
              submittedAt
              commit { oid }
            }
          }
        }
      }
    }`;
  const response = ghOk([
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
  ]);
  if (!response.ok) {
    return {
      readable: false,
      complete: false,
      branchProtectionRules: { pageInfo: { hasNextPage: true }, nodes: [] },
      latestOpinionatedReviews: { pageInfo: { hasNextPage: true }, nodes: [] },
      mergeQueue: null,
      error: response.error || "policy GraphQL request failed",
    };
  }
  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch {
    return {
      readable: false,
      complete: false,
      branchProtectionRules: { pageInfo: { hasNextPage: true }, nodes: [] },
      latestOpinionatedReviews: { pageInfo: { hasNextPage: true }, nodes: [] },
      mergeQueue: null,
      error: "policy GraphQL returned invalid JSON",
    };
  }
  if (payload.errors?.length) {
    return {
      readable: false,
      complete: false,
      branchProtectionRules: { pageInfo: { hasNextPage: true }, nodes: [] },
      latestOpinionatedReviews: { pageInfo: { hasNextPage: true }, nodes: [] },
      mergeQueue: null,
      error: JSON.stringify(payload.errors),
    };
  }
  const repository = payload.data?.repository;
  const pullRequest = repository?.pullRequest;
  if (!repository || !pullRequest) {
    return {
      readable: false,
      complete: false,
      branchProtectionRules: { pageInfo: { hasNextPage: true }, nodes: [] },
      latestOpinionatedReviews: { pageInfo: { hasNextPage: true }, nodes: [] },
      mergeQueue: null,
      error: "policy GraphQL returned an unexpected payload",
    };
  }
  const branchProtectionRules = repository.branchProtectionRules || {
    pageInfo: { hasNextPage: true },
    nodes: [],
  };
  const latestOpinionatedReviews = pullRequest.latestOpinionatedReviews || {
    pageInfo: { hasNextPage: true },
    nodes: [],
  };
  const complete =
    branchProtectionRules.pageInfo?.hasNextPage !== true &&
    latestOpinionatedReviews.pageInfo?.hasNextPage !== true;
  return {
    readable: true,
    complete,
    branchProtectionRules,
    latestOpinionatedReviews,
    mergeQueue: {
      enabled: pullRequest.isMergeQueueEnabled === true,
      inQueue: pullRequest.isInMergeQueue === true,
      entry: pullRequest.mergeQueueEntry || null,
    },
    error: complete ? null : "policy GraphQL pagination incomplete",
  };
}

function patternMatchesBranch(pattern, branch) {
  if (!pattern) return false;
  if (pattern === branch) return true;
  const expression = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<<STARSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<STARSTAR>>>/g, ".*");
  return new RegExp(`^${expression}$`).test(branch);
}

function fetchBranchProtection(owner, name, base, policy) {
  const matchingCount = (policy.branchProtectionRules?.nodes || []).filter((rule) =>
    patternMatchesBranch(rule?.pattern, base),
  ).length;
  const response = ghOk([
    "api",
    `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
  ]);
  if (response.ok) {
    try {
      return {
        required: matchingCount > 0,
        readable: true,
        complete: true,
        payload: JSON.parse(response.body),
        error: null,
      };
    } catch {
      return {
        required: matchingCount > 0,
        readable: false,
        complete: false,
        payload: null,
        error: "branch protection returned invalid JSON",
      };
    }
  }
  if (matchingCount === 0) {
    return {
      required: false,
      readable: true,
      complete: true,
      payload: null,
      error: null,
    };
  }
  return {
    required: true,
    readable: false,
    complete: false,
    payload: null,
    error: response.error || "branch protection request failed",
  };
}

function scanTargetWorkflows(owner, name, base, mergeQueueEnabled) {
  const listing = ghOk([
    "api",
    `repos/${owner}/${name}/contents/.github/workflows?ref=${encodeURIComponent(base)}`,
  ]);
  if (!listing.ok) {
    if (isNotFound(listing.error)) {
      return {
        readable: true,
        complete: true,
        scannedRef: base,
        workflowFiles: 0,
        hasMergeGroupTrigger: false,
        hasPullRequestTrigger: false,
        warning: mergeQueueEnabled
          ? "Merge queue is enabled, but the base has no workflow directory."
          : null,
        error: null,
      };
    }
    return {
      readable: false,
      complete: false,
      scannedRef: base,
      workflowFiles: 0,
      hasMergeGroupTrigger: null,
      hasPullRequestTrigger: null,
      warning: null,
      error: listing.error || "workflow listing request failed",
    };
  }

  let entries;
  try {
    entries = JSON.parse(listing.body);
  } catch {
    return {
      readable: false,
      complete: false,
      scannedRef: base,
      workflowFiles: 0,
      hasMergeGroupTrigger: null,
      hasPullRequestTrigger: null,
      warning: null,
      error: "workflow listing returned invalid JSON",
    };
  }
  if (!Array.isArray(entries)) {
    return {
      readable: false,
      complete: false,
      scannedRef: base,
      workflowFiles: 0,
      hasMergeGroupTrigger: null,
      hasPullRequestTrigger: null,
      warning: null,
      error: "workflow listing returned an unexpected payload",
    };
  }

  const files = entries.filter(
    (entry) => entry?.type === "file" && /\.ya?ml$/i.test(entry.name || ""),
  );
  let hasMergeGroupTrigger = false;
  let hasPullRequestTrigger = false;
  for (const entry of files) {
    const response = ghOk([
      "api",
      `repos/${owner}/${name}/contents/${entry.path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(base)}`,
    ]);
    if (!response.ok) {
      return {
        readable: false,
        complete: false,
        scannedRef: base,
        workflowFiles: files.length,
        hasMergeGroupTrigger,
        hasPullRequestTrigger,
        warning: null,
        error: response.error || `workflow ${entry.path} could not be read`,
      };
    }
    try {
      const payload = JSON.parse(response.body);
      const text = Buffer.from(payload.content || "", "base64").toString("utf8");
      if (/\bmerge_group\b/.test(text)) hasMergeGroupTrigger = true;
      if (/\bpull_request(?:_target)?\b/.test(text)) {
        hasPullRequestTrigger = true;
      }
    } catch {
      return {
        readable: false,
        complete: false,
        scannedRef: base,
        workflowFiles: files.length,
        hasMergeGroupTrigger,
        hasPullRequestTrigger,
        warning: null,
        error: `workflow ${entry.path} returned invalid JSON`,
      };
    }
  }
  return {
    readable: true,
    complete: true,
    scannedRef: base,
    workflowFiles: files.length,
    hasMergeGroupTrigger,
    hasPullRequestTrigger,
    warning:
      mergeQueueEnabled && !hasMergeGroupTrigger
        ? "Merge queue enabled but no target-base workflow mentions merge_group; queue checks may stall."
        : null,
    error: null,
  };
}

function fetchViewer() {
  const response = ghOk(["api", "user", "--jq", ".login"]);
  if (!response.ok) {
    return {
      readable: false,
      complete: false,
      login: null,
      error: response.error || "viewer request failed",
    };
  }
  const login = response.body.trim();
  return {
    readable: Boolean(login),
    complete: Boolean(login),
    login: login || null,
    error: login ? null : "viewer login was empty",
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
    "number,title,state,isDraft,url,baseRefName,headRefOid,mergeStateStatus,mergeable,reviewDecision,commits,author",
  ]);
  const reviewRequests = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/requested_reviewers`,
    "review requests",
    (payload) => [...(payload?.users || []), ...(payload?.teams || [])],
  );
  prEvidence.reviewRequests = reviewRequests.rows || [];
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
  const policy = fetchPolicy(owner, name, pr);
  const branchProtection = fetchBranchProtection(owner, name, base, policy);
  const codeowners = fetchCodeowners(owner, name, base);
  const workflowCoverage = scanTargetWorkflows(
    owner,
    name,
    base,
    policy.mergeQueue?.enabled === true,
  );
  const viewer = fetchViewer();

  const capture = assembleSnapshotCapture({
    prEvidence,
    changedFiles,
    activeRules,
    checkRuns,
    statuses,
    issueComments,
    reviewComments,
    reviews,
    threads,
    branchProtection,
    codeowners,
    policy,
    workflowCoverage,
    viewer,
  });

  const snapshot = createSnapshotEnvelope({
    repo,
    pr,
    headOid,
    capturedAt,
    sources: capture.sources,
    evidence: capture.evidence,
  });

  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (output) writeFileSync(output, json, "utf8");
  process.stdout.write(json);
  process.exitCode = snapshot.complete ? 0 : 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
