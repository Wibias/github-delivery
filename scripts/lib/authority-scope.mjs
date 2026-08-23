import { createHash } from "node:crypto";

import { actionDefinition } from "./mutation-action-registry.mjs";
import { parseRewriteExemption } from "./rewrite-exemption.mjs";
import { stripReviewAuthorityMarker } from "./review-verdict-marker.mjs";

const MUTATION_MODES = new Set(["read-only", "review", "maintainer", "autonomous"]);
const IDEMPOTENCY_MARKER_RE = /\n\n<!-- github-delivery:idempotency [0-9a-f]{64} -->\s*$/i;

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeMode(value) {
  const mode = String(value || "read-only").toLowerCase();
  if (!MUTATION_MODES.has(mode)) throw new Error("authority_scope_mutation_mode_invalid");
  return mode;
}

function required(value, name) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`authority_scope_${name}_required`);
  }
  return value;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`authority_scope_${name}_invalid`);
  }
  return number;
}

function visibleBody(value) {
  const withoutIdempotency = String(value ?? "").replace(IDEMPOTENCY_MARKER_RE, "");
  return stripReviewAuthorityMarker(withoutIdempotency);
}

function bodyHash(value) {
  return sha256(required(visibleBody(value), "body"));
}

function exactString(value, name) {
  return String(required(value, name));
}

function optionalExactString(value, name) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) throw new Error(`authority_scope_${name}_required`);
  return text;
}

function optionalRewriteExemption(value) {
  return parseRewriteExemption(value, "authority_scope_rewrite_exemption_invalid");
}

function normalizedStringSet(value, name, { optional = false } = {}) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new Error(`authority_scope_${name}_invalid`);
  const items = value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`authority_scope_${name}_entry_invalid`);
    }
    return entry.trim();
  });
  return [...new Set(items)].sort();
}

function base(request) {
  if (!plainObject(request)) throw new Error("authority_scope_request_invalid");
  const scope = {
    action: exactString(request.action, "action"),
    mutationMode: normalizeMode(request.mutationMode),
    repo: exactString(request.repo, "repo"),
  };
  const authorityBranch = typeof request.authorityBranch === "string"
    ? request.authorityBranch.trim()
    : "";
  if (authorityBranch) scope.authorityBranch = authorityBranch;
  return scope;
}

function prScope(request) {
  return {
    pr: positiveInteger(request.pr, "pr"),
    expectedHead: exactString(request.expectedHead, "expected_head"),
  };
}

function normalizedReviewers(reviewers) {
  if (!Array.isArray(reviewers)) throw new Error("authority_scope_reviewers_invalid");
  const values = reviewers.map((value) => String(value || "").trim()).filter(Boolean);
  if (!values.length) throw new Error("authority_scope_reviewers_required");
  return [...new Set(values)].sort();
}

function normalizeMergeMethod(value) {
  return value === "squash" || value === "rebase" ? value : "merge";
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical_json_number_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (plainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("canonical_json_type_invalid");
}

export function authorityScopeForRequest(request = {}) {
  const scope = base(request);
  const definition = actionDefinition(scope.action);
  const scopeKind = definition?.authorityScopeKind || null;
  if (!definition?.mutation || !scopeKind) {
    throw new Error(`authority_scope_unsupported_action:${scope.action}`);
  }

  switch (scopeKind) {
    case "merge_pr":
      return {
        ...scope,
        ...prScope(request),
        expectedBase: exactString(request.expectedBase, "expected_base"),
        expectedBaseOid: exactString(request.expectedBaseOid, "expected_base_oid").toLowerCase(),
        mergeMethod: normalizeMergeMethod(request.mergeMethod),
      };

    case "retarget_pr":
      return {
        ...scope,
        ...prScope(request),
        expectedBase: exactString(request.expectedBase, "expected_base"),
        newBase: exactString(request.newBase, "new_base"),
      };

    case "push_code": {
      const rewriteExemption = optionalRewriteExemption(request.rewriteExemption);
      return {
        ...scope,
        remote: exactString(request.remote, "remote"),
        branch: exactString(request.branch, "branch"),
        expectedRemoteTip: exactString(request.expectedRemoteTip, "expected_remote_tip"),
        newTip: exactString(request.newTip, "new_tip"),
        forceWithLease: request.forceWithLease === true,
        ...(rewriteExemption ? { rewriteExemption } : {}),
      };
    }

    case "create_pr": {
      const headRepo = optionalExactString(request.headRepo, "head_repo");
      return {
        ...scope,
        base: exactString(request.base, "base"),
        head: exactString(request.head, "head"),
        ...(headRepo ? { headRepo } : {}),
        draft: request.draft === true,
        idempotencyKey: exactString(request.idempotencyKey, "idempotency_key"),
        titleSha256: sha256(exactString(request.title, "title")),
        bodySha256: bodyHash(request.body),
      };
    }

    case "update_pr_body": {
      const approvedMediaRemovals = normalizedStringSet(
        request.approvedMediaRemovals,
        "approved_media_removals",
        { optional: true },
      );
      return {
        ...scope,
        ...prScope(request),
        bodySha256: bodyHash(request.body),
        ...(approvedMediaRemovals.length ? { approvedMediaRemovals } : {}),
      };
    }

    case "create_issue":
      return {
        ...scope,
        idempotencyKey: exactString(request.idempotencyKey, "idempotency_key"),
        titleSha256: sha256(exactString(request.title, "title")),
        bodySha256: bodyHash(request.body),
      };

    case "assign_issue":
      return {
        ...scope,
        issue: positiveInteger(request.issue, "issue"),
        assignee: exactString(request.assignee, "assignee"),
      };

    case "pr_body_social":
      return {
        ...scope,
        ...prScope(request),
        idempotencyKey: exactString(request.idempotencyKey, "idempotency_key"),
        bodySha256: bodyHash(request.body),
      };

    case "issue_comment":
      return {
        ...scope,
        issue: positiveInteger(request.issue, "issue"),
        idempotencyKey: exactString(request.idempotencyKey, "idempotency_key"),
        bodySha256: bodyHash(request.body),
      };

    case "edit_own_comment":
      return {
        ...scope,
        ...prScope(request),
        commentId: positiveInteger(request.commentId, "comment_id"),
        idempotencyKey: exactString(request.idempotencyKey, "idempotency_key"),
        bodySha256: bodyHash(request.body),
      };

    case "reply_thread":
      return {
        ...scope,
        ...prScope(request),
        commentId: positiveInteger(request.commentId, "comment_id"),
        idempotencyKey: exactString(request.idempotencyKey, "idempotency_key"),
        bodySha256: bodyHash(request.body),
      };

    case "resolve_thread":
      return {
        ...scope,
        ...prScope(request),
        threadId: exactString(request.threadId, "thread_id"),
      };

    case "change_draft_state":
      return {
        ...scope,
        ...prScope(request),
        ready: request.ready !== false,
      };

    case "request_reviewers":
      return {
        ...scope,
        ...prScope(request),
        reviewers: normalizedReviewers(request.reviewers),
      };

    case "close_pr":
      return {
        ...scope,
        ...prScope(request),
      };

    case "supersede_pr": {
      const supersedingPr = request.supersedingPr
        ? positiveInteger(request.supersedingPr, "superseding_pr")
        : undefined;
      const body = request.body
        ? visibleBody(request.body)
        : supersedingPr
          ? `Superseded by PR #${supersedingPr}.`
          : null;
      if (!body) throw new Error("authority_scope_body_or_superseding_pr_required");
      return {
        ...scope,
        ...prScope(request),
        ...(supersedingPr ? { supersedingPr } : {}),
        idempotencyKey: exactString(request.idempotencyKey, "idempotency_key"),
        bodySha256: sha256(body),
      };
    }

    case "close_linked_issue":
      return {
        ...scope,
        pr: positiveInteger(required(request.pr, "pr"), "pr"),
        issue: positiveInteger(request.issue, "issue"),
      };

    case "delete_head_branch":
      return {
        ...scope,
        pr: positiveInteger(request.pr, "pr"),
        targetRepo: exactString(request.targetRepo, "target_repo"),
        headRefName: exactString(request.headRefName, "head_ref_name"),
      };

    default:
      throw new Error(`authority_scope_unsupported_action:${scope.action}`);
  }
}

export function authorityScopeSha256(request = {}) {
  return sha256(canonicalJson(authorityScopeForRequest(request)));
}

export function authorityBatchSha256(operations = []) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("authority_batch_operations_required");
  }
  return sha256(canonicalJson(operations.map((request) => authorityScopeForRequest(request))));
}
