import { validateCommentReviewResult } from "../comment-review-result.mjs";

const PASS_IDS = Object.freeze(["no-comments", "simplify"]);
const OUTCOMES = new Set(["clean", "applied", "skipped"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, code) {
  const text = String(value || "").trim();
  if (!text) throw new Error(code);
  return text;
}

function validateNoComments(entry) {
  const outcome = requiredString(entry?.outcome, "pre_open_hygiene_no_comments_outcome_required");
  if (!OUTCOMES.has(outcome)) throw new Error("pre_open_hygiene_no_comments_outcome_invalid");
  const method = requiredString(entry?.method, "pre_open_hygiene_no_comments_method_required");
  if (outcome === "skipped") {
    if (method !== "opt-out" || !String(entry?.reason || "").trim()) {
      throw new Error("pre_open_hygiene_no_comments_skip_invalid");
    }
  } else {
    if (entry?.scopeKind !== "diff-added-lines") {
      throw new Error("pre_open_hygiene_no_comments_scope_invalid");
    }
    if (entry?.resultValid !== true) {
      throw new Error("pre_open_hygiene_no_comments_result_invalid");
    }
    if (entry?.workspaceVerified !== true) {
      throw new Error("pre_open_hygiene_no_comments_workspace_unverified");
    }
  }
  return {
    outcome,
    method,
    ...(outcome === "skipped"
      ? { reason: String(entry.reason).trim() }
      : {
          scopeKind: "diff-added-lines",
          resultValid: true,
          workspaceVerified: true,
        }),
  };
}

function validateSimplify(entry) {
  const outcome = requiredString(entry?.outcome, "pre_open_hygiene_simplify_outcome_required");
  if (!OUTCOMES.has(outcome)) throw new Error("pre_open_hygiene_simplify_outcome_invalid");
  const method = requiredString(entry?.method, "pre_open_hygiene_simplify_method_required");
  if (outcome === "skipped") {
    if (method !== "opt-out" || !String(entry?.reason || "").trim()) {
      throw new Error("pre_open_hygiene_simplify_skip_invalid");
    }
  } else if (entry?.validationPassed !== true) {
    throw new Error("pre_open_hygiene_simplify_validation_required");
  }
  return {
    outcome,
    method,
    ...(outcome === "skipped"
      ? { reason: String(entry.reason).trim() }
      : { validationPassed: true }),
  };
}

export function validatePreOpenHygieneEvidence(value, { headSha = null } = {}) {
  if (!plainObject(value)) throw new Error("pre_open_hygiene_evidence_invalid");
  if (value.schemaVersion !== 1 || value.kind !== "github-delivery/pre-open-hygiene-evidence") {
    throw new Error("pre_open_hygiene_evidence_schema_invalid");
  }
  const evidenceHead = requiredString(value.headSha, "pre_open_hygiene_head_required");
  if (headSha && evidenceHead.toLowerCase() !== String(headSha).toLowerCase()) {
    throw new Error("pre_open_hygiene_head_mismatch");
  }
  if (!plainObject(value.passes)) throw new Error("pre_open_hygiene_passes_required");
  for (const id of PASS_IDS) {
    if (!plainObject(value.passes[id])) throw new Error(`pre_open_hygiene_${id.replaceAll("-", "_")}_missing`);
  }
  return {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-hygiene-evidence",
    headSha: evidenceHead,
    passes: {
      "no-comments": validateNoComments(value.passes["no-comments"]),
      simplify: validateSimplify(value.passes.simplify),
    },
  };
}

/**
 * Convert the deterministic no-comments boundaries plus the simplify result into
 * the only hygiene-evidence shape accepted by the pre-open gate.
 *
 * A reviewer DELETE cannot be converted into a clean receipt: the parent must
 * apply the accepted change, revalidate the candidate, and rerun hygiene on the
 * new head. This keeps the builder from turning a finding into completion.
 */
export function buildPreOpenHygieneEvidence({
  scope,
  commentResult,
  guardVerification,
  simplify,
  headSha,
} = {}) {
  if (!plainObject(scope) || scope.schemaVersion !== 1 || scope.kind !== "github-delivery/comment-review-scope") {
    throw new Error("pre_open_hygiene_comment_scope_invalid");
  }
  const expectedHead = requiredString(headSha, "pre_open_hygiene_head_required");
  if (scope.headRef && String(scope.headRef).toLowerCase() !== expectedHead.toLowerCase()) {
    throw new Error("pre_open_hygiene_comment_scope_head_mismatch");
  }
  if (
    !plainObject(guardVerification) ||
    guardVerification.unchanged !== true ||
    (Array.isArray(guardVerification.changedFiles) && guardVerification.changedFiles.length !== 0)
  ) {
    throw new Error("pre_open_hygiene_comment_workspace_unverified");
  }
  const scopedFileCount = Array.isArray(scope.files) ? scope.files.length : 0;
  if (
    Number.isInteger(guardVerification.fileCount) &&
    guardVerification.fileCount !== scopedFileCount
  ) {
    throw new Error("pre_open_hygiene_comment_guard_scope_mismatch");
  }

  const validatedResult = validateCommentReviewResult(scope, commentResult);
  if (validatedResult.deletionCount !== 0 || validatedResult.rootCauseFlags.length !== 0) {
    throw new Error("pre_open_hygiene_no_comments_changes_pending");
  }

  const candidate = {
    schemaVersion: 1,
    kind: "github-delivery/pre-open-hygiene-evidence",
    headSha: expectedHead,
    passes: {
      "no-comments": {
        outcome: "clean",
        method: "comment-inspector",
        scopeKind: "diff-added-lines",
        resultValid: true,
        workspaceVerified: true,
      },
      simplify: validateSimplify(simplify),
    },
  };
  return validatePreOpenHygieneEvidence(candidate, { headSha: expectedHead });
}

export function preOpenHygieneReceipts(value, { headSha, now = Date.now } = {}) {
  const evidence = validatePreOpenHygieneEvidence(value, { headSha });
  const recordedAt = now();
  return {
    noComments: {
      status: "done",
      headSha: evidence.headSha,
      source: "pre-open-gate",
      outcome: evidence.passes["no-comments"].outcome,
      method: evidence.passes["no-comments"].method,
      recordedAt,
    },
    simplify: {
      status: "done",
      headSha: evidence.headSha,
      source: "pre-open-gate",
      outcome: evidence.passes.simplify.outcome,
      method: evidence.passes.simplify.method,
      recordedAt,
    },
  };
}
