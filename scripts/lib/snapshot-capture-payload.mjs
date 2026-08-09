import { createHash } from "node:crypto";

function collectionSource(collection, required = true) {
  return {
    required,
    readable: collection?.readable === true,
    complete: collection?.complete === true,
    pages: collection?.pages ?? null,
    error: collection?.error || null,
  };
}

function isExplicitNotFound(error) {
  return /(?:HTTP\s+404|\b404\b|Not Found)/i.test(String(error || ""));
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("snapshot_boundary_number_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("snapshot_boundary_value_invalid");
}

export function snapshotBoundaryFingerprint(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function classifyBranchProtectionResponse(response = {}) {
  if (response.ok === true) {
    try {
      return {
        required: true,
        readable: true,
        complete: true,
        payload: JSON.parse(response.body || "null"),
        error: null,
      };
    } catch {
      return {
        required: true,
        readable: false,
        complete: false,
        payload: null,
        error: "branch protection returned invalid JSON",
      };
    }
  }
  if (isExplicitNotFound(response.error)) {
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

export function verifySnapshotBoundary(
  initialPr = {},
  finalPr = {},
  {
    initialBaseOid = null,
    finalBaseOid = null,
    initialRules = null,
    finalRules = null,
    initialTestMergeOid = undefined,
    finalTestMergeOid = undefined,
  } = {},
) {
  const initialHead = String(initialPr.headRefOid || "").toLowerCase();
  const finalHead = String(finalPr.headRefOid || "").toLowerCase();
  if (!initialHead || !finalHead || initialHead !== finalHead) {
    throw new Error(
      `snapshot_head_moved: expected ${initialHead || "missing"}, observed ${finalHead || "missing"}`,
    );
  }
  const initialBase = String(initialPr.baseRefName || "");
  const finalBase = String(finalPr.baseRefName || "");
  if (!initialBase || !finalBase || initialBase !== finalBase) {
    throw new Error(
      `snapshot_base_moved: expected ${initialBase || "missing"}, observed ${finalBase || "missing"}`,
    );
  }

  for (const field of ["reviewDecision", "mergeStateStatus", "mergeable", "isDraft", "updatedAt"]) {
    const before = initialPr[field];
    const after = finalPr[field];
    if (before !== undefined && after !== undefined && before !== after) {
      throw new Error(`snapshot_pr_state_moved:${field}`);
    }
  }

  let baseOid = null;
  if (initialBaseOid !== null || finalBaseOid !== null) {
    const before = String(initialBaseOid || "").toLowerCase();
    const after = String(finalBaseOid || "").toLowerCase();
    if (!before || !after) throw new Error("snapshot_base_oid_missing");
    if (before !== after) {
      throw new Error(`snapshot_base_oid_moved: expected ${before}, observed ${after}`);
    }
    baseOid = before;
  }

  let testMergeOid;
  if (initialTestMergeOid !== undefined || finalTestMergeOid !== undefined) {
    const before = initialTestMergeOid ? String(initialTestMergeOid).toLowerCase() : null;
    const after = finalTestMergeOid ? String(finalTestMergeOid).toLowerCase() : null;
    if (before !== after) {
      throw new Error(
        `snapshot_test_merge_oid_moved: expected ${before || "missing"}, observed ${after || "missing"}`,
      );
    }
    testMergeOid = before;
  }

  let rulesFingerprint = null;
  if (initialRules !== null || finalRules !== null) {
    if (initialRules?.complete !== true || finalRules?.complete !== true) {
      throw new Error("snapshot_rules_boundary_incomplete");
    }
    const before = snapshotBoundaryFingerprint(initialRules.rows || []);
    const after = snapshotBoundaryFingerprint(finalRules.rows || []);
    if (before !== after) {
      throw new Error(`snapshot_rules_moved: expected ${before}, observed ${after}`);
    }
    rulesFingerprint = before;
  }

  return {
    headOid: initialHead,
    baseRefName: initialBase,
    ...(baseOid ? { baseOid } : {}),
    ...(testMergeOid ? { testMergeOid } : {}),
    ...(rulesFingerprint ? { rulesFingerprint } : {}),
  };
}

export function assembleSnapshotCapture({
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
  boundary = null,
  checkEvidence = null,
} = {}) {
  const sources = {
    pr: { required: true, readable: true, complete: true, error: null },
    changedFiles: collectionSource(changedFiles),
    activeRules: collectionSource(activeRules),
    checkRuns: collectionSource(checkRuns),
    statuses: collectionSource(statuses),
    issueComments: collectionSource(issueComments),
    reviewComments: collectionSource(reviewComments),
    reviews: collectionSource(reviews),
    reviewThreads: collectionSource(threads),
    branchProtection: {
      required: branchProtection?.required === true,
      readable: branchProtection?.readable === true,
      complete: branchProtection?.complete === true,
      error: branchProtection?.error || null,
    },
    codeowners: {
      required: false,
      readable: codeowners?.readable === true,
      complete: codeowners?.complete === true,
      error: codeowners?.error || null,
    },
    codeownersErrors: {
      required: false,
      readable: codeowners?.errorsReadable === true,
      complete: codeowners?.errorsComplete === true,
      error: codeowners?.errorsError || null,
    },
    policyGraphql: {
      required: true,
      readable: policy?.readable === true,
      complete: policy?.complete === true,
      error: policy?.error || null,
    },
    workflowCoverage: {
      required: true,
      readable: workflowCoverage?.readable === true,
      complete: workflowCoverage?.complete === true,
      error: workflowCoverage?.error || null,
    },
    viewer: {
      required: true,
      readable: viewer?.readable === true,
      complete: viewer?.complete === true,
      error: viewer?.error || null,
    },
  };

  return {
    sources,
    evidence: {
      pullRequest: prEvidence,
      captureBoundary: boundary,
      changedFiles: changedFiles?.rows || [],
      branchProtection: branchProtection?.payload ?? null,
      activeRules: activeRules?.rows || [],
      checks: {
        checkRuns: checkRuns?.rows || [],
        statuses: statuses?.rows || [],
        ...(checkEvidence
          ? {
              authoritative: checkEvidence.authoritative || null,
              head: checkEvidence.head || null,
              testMerge: checkEvidence.testMerge || null,
            }
          : {}),
      },
      feedback: {
        issueComments: issueComments?.rows || [],
        reviewComments: reviewComments?.rows || [],
        reviews: reviews?.rows || [],
        reviewThreads: threads?.rows || [],
      },
      codeowners: {
        path: codeowners?.path || null,
        text: codeowners?.text || null,
        errors: codeowners?.errors || [],
      },
      policy: {
        branchProtectionRules: policy?.branchProtectionRules || {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        latestOpinionatedReviews: policy?.latestOpinionatedReviews || {
          pageInfo: { hasNextPage: false },
          nodes: [],
        },
        mergeQueue: policy?.mergeQueue || {
          enabled: false,
          inQueue: false,
          entry: null,
        },
      },
      workflowCoverage: workflowCoverage
        ? {
            complete: workflowCoverage.complete === true,
            scannedRef: workflowCoverage.scannedRef || null,
            workflowFiles: workflowCoverage.workflowFiles || 0,
            hasPullRequestTrigger:
              workflowCoverage.hasPullRequestTrigger ?? null,
            hasMergeGroupTrigger:
              workflowCoverage.hasMergeGroupTrigger ?? null,
            warning: workflowCoverage.warning || null,
          }
        : null,
      viewer: { login: viewer?.login || null },
    },
  };
}
