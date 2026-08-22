#!/usr/bin/env node
/**
 * Capture one timestamped GitHub evidence snapshot for a pull request.
 * Usage: node scripts/ship-gate-snapshot.mjs OWNER/REPO PR_NUMBER [--output FILE]
 * Requires: gh auth
 */
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import {
  evaluateRequiredCheckWorkflowMapping,
  workflowRunIdFromCheckRun,
} from "./lib/merge-group-workflow-coverage.mjs";
import {
  assembleSnapshotCapture,
  classifyBranchProtectionResponse,
  verifySnapshotBoundary,
} from "./lib/snapshot-capture-payload.mjs";
import { collectPaginated } from "./lib/github-pagination.mjs";
import {
  normalizeRequiredChecks,
  selectAuthoritativeCheckEvidence,
} from "./lib/required-checks-policy.mjs";
import { createSnapshotEnvelope } from "./lib/snapshot-schema.mjs";
import {
  attachRepositoryPermissions,
  feedbackPermissionLogins,
} from "./lib/feedback-authority.mjs";
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { graphqlCliField } from "./lib/graphql-cli-fields.mjs";
import { normalizeNativeStack } from "./lib/native-stack-policy.mjs";

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
  const result = boundedSpawnSync("gh", args, {
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

function emptyCollection() {
  return { readable: true, complete: true, pages: 0, rows: [], error: null };
}

function selectedCollection(rows, selected, label) {
  return {
    readable: selected.complete === true,
    complete: selected.complete === true,
    pages: null,
    rows: rows || [],
    error: selected.complete
      ? null
      : `${label} authoritative evidence incomplete: ${selected.incompleteReasons.join(", ")}`,
  };
}

function markFeedbackAuthorityIncomplete(collection, error) {
  return {
    ...collection,
    complete: false,
    error: collection?.error ? `${collection.error}; ${error}` : error,
  };
}

function enrichFeedbackAuthority(owner, name, collections) {
  const permissionsByLogin = {};
  for (const login of feedbackPermissionLogins(collections)) {
    const response = ghOk([
      "api",
      `repos/${owner}/${name}/collaborators/${encodeURIComponent(login)}/permission`,
    ]);
    if (!response.ok) {
      if (isNotFound(response.error)) {
        permissionsByLogin[login] = "none";
        continue;
      }
      const error = `feedback_repository_permission_unreadable:${login}:${response.error || "request failed"}`;
      return collections.map((collection) =>
        markFeedbackAuthorityIncomplete(
          attachRepositoryPermissions(collection, permissionsByLogin),
          error,
        ),
      );
    }
    let payload;
    try {
      payload = JSON.parse(response.body || "null");
    } catch {
      const error = `feedback_repository_permission_invalid_json:${login}`;
      return collections.map((collection) =>
        markFeedbackAuthorityIncomplete(
          attachRepositoryPermissions(collection, permissionsByLogin),
          error,
        ),
      );
    }
    const permission = String(payload?.permission || "").toLowerCase();
    if (!new Set(["admin", "write", "maintain", "read", "triage", "none"]).has(permission)) {
      const error = `feedback_repository_permission_invalid:${login}:${permission || "missing"}`;
      return collections.map((collection) =>
        markFeedbackAuthorityIncomplete(
          attachRepositoryPermissions(collection, permissionsByLogin),
          error,
        ),
      );
    }
    permissionsByLogin[login] = permission;
  }
  return collections.map((collection) =>
    attachRepositoryPermissions(collection, permissionsByLogin),
  );
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
      `owner=${graphqlCliField(owner, "owner")}`,
      "-F",
      `name=${graphqlCliField(name, "name")}`,
      "-F",
      `number=${pr}`,
    ];
    if (after) args.push("-F", `after=${graphqlCliField(after, "after")}`);
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
          stack { number size baseRefName }
          stackEntry { position }
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
    `owner=${graphqlCliField(owner, "owner")}`,
    "-F",
    `name=${graphqlCliField(name, "name")}`,
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
    nativeStack: {
      queried: true,
      ...(Object.prototype.hasOwnProperty.call(pullRequest, "stack")
        ? { stack: pullRequest.stack }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(pullRequest, "stackEntry")
        ? { stackEntry: pullRequest.stackEntry }
        : {}),
    },
    stack: Object.prototype.hasOwnProperty.call(pullRequest, "stack")
      ? pullRequest.stack
      : undefined,
    stackEntry: Object.prototype.hasOwnProperty.call(pullRequest, "stackEntry")
      ? pullRequest.stackEntry
      : undefined,
    error: complete ? null : "policy GraphQL pagination incomplete",
  };
}

function fetchBranchProtection(owner, name, base) {
  return classifyBranchProtectionResponse(
    ghOk([
      "api",
      `repos/${owner}/${name}/branches/${encodeURIComponent(base)}/protection`,
    ]),
  );
}

function fetchBranchOid(owner, name, base) {
  const response = ghOk([
    "api",
    `repos/${owner}/${name}/branches/${encodeURIComponent(base)}`,
    "--jq",
    ".commit.sha",
  ]);
  if (!response.ok) {
    throw new Error(response.error || `base branch ${base} could not be read`);
  }
  const oid = response.body.trim().toLowerCase();
  if (!oid) throw new Error(`base branch ${base} returned an empty commit SHA`);
  return oid;
}

function fetchRestPull(owner, name, pr) {
  return ghJson(["api", `repos/${owner}/${name}/pulls/${pr}`]);
}

function fetchTestMergeOid(owner, name, pr, restPull = null) {
  const payload = restPull || fetchRestPull(owner, name, pr);
  const oid = String(payload?.merge_commit_sha || "").trim().toLowerCase();
  return oid || null;
}

function scanTargetWorkflows(
  owner,
  name,
  base,
  mergeQueueEnabled,
  { requiredChecks = [], authoritativeCheckRuns = [] } = {},
) {
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
        requiredCheckWorkflowMappingComplete: !mergeQueueEnabled && requiredChecks.length === 0,
        requiredGithubActionsCheckCount: 0,
        mappings: [],
        unmapped: mergeQueueEnabled
          ? [{ reason: "workflow_directory_missing" }]
          : [],
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
      requiredCheckWorkflowMappingComplete: false,
      requiredGithubActionsCheckCount: null,
      mappings: [],
      unmapped: [{ reason: "workflow_listing_unreadable" }],
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
      requiredCheckWorkflowMappingComplete: false,
      requiredGithubActionsCheckCount: null,
      mappings: [],
      unmapped: [{ reason: "workflow_listing_invalid_json" }],
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
      requiredCheckWorkflowMappingComplete: false,
      requiredGithubActionsCheckCount: null,
      mappings: [],
      unmapped: [{ reason: "workflow_listing_unexpected_payload" }],
      warning: null,
      error: "workflow listing returned an unexpected payload",
    };
  }

  const files = entries.filter(
    (entry) => entry?.type === "file" && /\.ya?ml$/i.test(entry.name || ""),
  );
  let hasMergeGroupTrigger = false;
  let hasPullRequestTrigger = false;
  const workflowTexts = {};
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
        requiredCheckWorkflowMappingComplete: false,
        requiredGithubActionsCheckCount: null,
        mappings: [],
        unmapped: [{ path: entry.path, reason: "workflow_source_unreadable" }],
        warning: null,
        error: response.error || `workflow ${entry.path} could not be read`,
      };
    }
    try {
      const payload = JSON.parse(response.body);
      const text = Buffer.from(payload.content || "", "base64").toString("utf8");
      workflowTexts[entry.path] = text;
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
        requiredCheckWorkflowMappingComplete: false,
        requiredGithubActionsCheckCount: null,
        mappings: [],
        unmapped: [{ path: entry.path, reason: "workflow_source_invalid_json" }],
        warning: null,
        error: `workflow ${entry.path} returned invalid JSON`,
      };
    }
  }

  let mapping = {
    requiredGithubActionsCheckCount: 0,
    requiredCheckWorkflowMappingComplete: true,
    mappings: [],
    unmapped: [],
  };
  if (mergeQueueEnabled) {
    const workflowRunPaths = {};
    for (const row of authoritativeCheckRuns) {
      const runId = workflowRunIdFromCheckRun(row);
      if (!runId || workflowRunPaths[String(runId)]) continue;
      const response = ghOk([
        "api",
        `repos/${owner}/${name}/actions/runs/${runId}`,
      ]);
      if (!response.ok) {
        return {
          readable: false,
          complete: false,
          scannedRef: base,
          workflowFiles: files.length,
          hasMergeGroupTrigger,
          hasPullRequestTrigger,
          requiredCheckWorkflowMappingComplete: false,
          requiredGithubActionsCheckCount: null,
          mappings: [],
          unmapped: [{ runId, reason: "workflow_run_metadata_unreadable" }],
          warning: null,
          error: response.error || `workflow run ${runId} could not be read`,
        };
      }
      try {
        const payload = JSON.parse(response.body);
        if (payload?.path) workflowRunPaths[String(runId)] = payload.path;
      } catch {
        return {
          readable: false,
          complete: false,
          scannedRef: base,
          workflowFiles: files.length,
          hasMergeGroupTrigger,
          hasPullRequestTrigger,
          requiredCheckWorkflowMappingComplete: false,
          requiredGithubActionsCheckCount: null,
          mappings: [],
          unmapped: [{ runId, reason: "workflow_run_metadata_invalid_json" }],
          warning: null,
          error: `workflow run ${runId} returned invalid JSON`,
        };
      }
    }
    mapping = evaluateRequiredCheckWorkflowMapping({
      descriptors: requiredChecks,
      checkRuns: authoritativeCheckRuns,
      workflowRunPaths,
      workflowTexts,
    });
  }

  return {
    readable: true,
    complete: true,
    scannedRef: base,
    workflowFiles: files.length,
    hasMergeGroupTrigger,
    hasPullRequestTrigger,
    ...mapping,
    warning:
      mergeQueueEnabled && !mapping.requiredCheckWorkflowMappingComplete
        ? "Merge queue enabled but one or more required GitHub Actions checks cannot be proven to come from workflows handling merge_group."
        : mergeQueueEnabled && !hasMergeGroupTrigger
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
    "number,title,state,isDraft,url,updatedAt,baseRefName,headRefOid,mergeStateStatus,mergeable,reviewDecision,commits,author",
  ]);
  const reviewRequests = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/requested_reviewers`,
    "review requests",
    (payload) => [...(payload?.users || []), ...(payload?.teams || [])],
  );
  prEvidence.reviewRequests = reviewRequests.rows || [];
  const base = prEvidence.baseRefName;
  const restPull = fetchRestPull(owner, name, pr);
  const policy = fetchPolicy(owner, name, pr);
  if (
    policy.nativeStack?.queried === true &&
    Object.prototype.hasOwnProperty.call(policy.nativeStack, "stack")
  ) {
    prEvidence.stack = policy.nativeStack.stack;
  }
  if (
    policy.nativeStack?.queried === true &&
    Object.prototype.hasOwnProperty.call(policy.nativeStack, "stackEntry")
  ) {
    prEvidence.stackEntry = policy.nativeStack.stackEntry;
  }
  const protectionBase =
    normalizeNativeStack(prEvidence.stack).baseRefName || base;
  const headOid = prEvidence.headRefOid;
  const baseOid = fetchBranchOid(owner, name, base);
  const testMergeOid = fetchTestMergeOid(owner, name, pr, restPull);

  const changedFiles = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/files`,
    "changed files",
  );
  const activeRules = restCollection(
    `repos/${owner}/${name}/rules/branches/${encodeURIComponent(protectionBase)}`,
    "active rules",
  );
  const headCheckRuns = restCollection(
    `repos/${owner}/${name}/commits/${headOid}/check-runs`,
    "head check runs",
    (payload) => payload?.check_runs,
  );
  const headStatuses = restCollection(
    `repos/${owner}/${name}/commits/${headOid}/statuses`,
    "head commit statuses",
  );
  const testMergeCheckRuns = testMergeOid
    ? restCollection(
        `repos/${owner}/${name}/commits/${testMergeOid}/check-runs`,
        "test merge check runs",
        (payload) => payload?.check_runs,
      )
    : emptyCollection();
  const testMergeStatuses = testMergeOid
    ? restCollection(
        `repos/${owner}/${name}/commits/${testMergeOid}/statuses`,
        "test merge commit statuses",
      )
    : emptyCollection();
  const selectedChecks = selectAuthoritativeCheckEvidence({
    headOid,
    testMergeOid,
    headCheckRuns: headCheckRuns.rows,
    headStatuses: headStatuses.rows,
    testMergeCheckRuns: testMergeCheckRuns.rows,
    testMergeStatuses: testMergeStatuses.rows,
    headEvidenceComplete: headCheckRuns.complete && headStatuses.complete,
    testMergeEvidenceComplete:
      testMergeCheckRuns.complete && testMergeStatuses.complete,
    mergeStateStatus: prEvidence.mergeStateStatus,
  });
  const checkRuns = selectedCollection(
    selectedChecks.checkRuns,
    selectedChecks,
    "check runs",
  );
  const statuses = selectedCollection(
    selectedChecks.statuses,
    selectedChecks,
    "commit statuses",
  );
  let issueComments = restCollection(
    `repos/${owner}/${name}/issues/${pr}/comments`,
    "issue comments",
  );
  let reviewComments = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/comments`,
    "review comments",
  );
  let reviews = restCollection(
    `repos/${owner}/${name}/pulls/${pr}/reviews`,
    "review submissions",
  );
  [issueComments, reviewComments, reviews] = enrichFeedbackAuthority(
    owner,
    name,
    [issueComments, reviewComments, reviews],
  );
  const threads = reviewThreads(owner, name, pr);
  const branchProtection = fetchBranchProtection(owner, name, protectionBase);
  const codeowners = fetchCodeowners(owner, name, protectionBase);
  const requiredChecks = normalizeRequiredChecks({
    classicRequiredStatusChecks:
      branchProtection?.payload?.required_status_checks || null,
    activeRules: activeRules.rows || [],
  }).descriptors;
  const workflowCoverage = scanTargetWorkflows(
    owner,
    name,
    protectionBase,
    policy.mergeQueue?.enabled === true,
    {
      requiredChecks,
      authoritativeCheckRuns: selectedChecks.checkRuns || [],
    },
  );
  const viewer = fetchViewer();

  const finalActiveRules = restCollection(
    `repos/${owner}/${name}/rules/branches/${encodeURIComponent(protectionBase)}`,
    "final active rules",
  );
  const finalBaseOid = fetchBranchOid(owner, name, base);
  const finalTestMergeOid = fetchTestMergeOid(owner, name, pr);
  const finalPrEvidence = ghJson([
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "baseRefName,headRefOid,reviewDecision,mergeStateStatus,mergeable,isDraft,updatedAt",
  ]);
  const boundary = verifySnapshotBoundary(prEvidence, finalPrEvidence, {
    initialBaseOid: baseOid,
    finalBaseOid,
    initialRules: activeRules,
    finalRules: finalActiveRules,
    initialTestMergeOid: testMergeOid,
    finalTestMergeOid,
  });

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
    boundary,
    checkEvidence: {
      authoritative: {
        sha: selectedChecks.sha,
        reason: selectedChecks.reason,
        complete: selectedChecks.complete,
        incompleteReasons: selectedChecks.incompleteReasons,
      },
      head: {
        sha: headOid,
        complete: headCheckRuns.complete && headStatuses.complete,
        checkRuns: headCheckRuns.rows,
        statuses: headStatuses.rows,
      },
      testMerge: testMergeOid
        ? {
            sha: testMergeOid,
            complete: testMergeCheckRuns.complete && testMergeStatuses.complete,
            checkRuns: testMergeCheckRuns.rows,
            statuses: testMergeStatuses.rows,
          }
        : null,
    },
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
