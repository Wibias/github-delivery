import { attachAuthorityGrants } from "./authority-batch.mjs";
import { refreshExpectedHeads } from "./authority-head-refresh.mjs";
import { authorizeBatchSync } from "./authority-host-client.mjs";
import {
  authorityRuntimeEnvironment,
  executeMutationWithAuthority,
  mutationAuthorityRequired,
  mutationRequiresTrustedAuthority,
  planMutationWithAuthority,
} from "./mutation-execution-context.mjs";
import { stampAuthorizedReviewVerdicts } from "./review-verdict-marker.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneRequests(requests) {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error("mutation_document_requests_required");
  }
  if (!requests.every((request) => plainObject(request))) {
    throw new Error("mutation_document_request_invalid");
  }
  return requests.map((request) => structuredClone(request));
}

export function requestsFromMutationDocument(document) {
  if (Array.isArray(document)) {
    return { requests: cloneRequests(document), singular: false };
  }
  if (!plainObject(document)) {
    throw new Error("mutation_document_requests_required");
  }
  if (Array.isArray(document.operations)) {
    return { requests: cloneRequests(document.operations), singular: false };
  }
  if (Array.isArray(document.requests)) {
    return { requests: cloneRequests(document.requests), singular: false };
  }
  if (typeof document.action === "string" && document.action) {
    return { requests: [structuredClone(document)], singular: true };
  }
  throw new Error("mutation_document_requests_required");
}

function assertPublicMutationDocument(requests) {
  const merge = requests.find((request) => request?.action === "merge_pr");
  if (merge) {
    throw new Error(
      "merge_pr_requires_merge_driver: use scripts/merge-pr-driver.mjs so ship-gate, review evidence, settle, and final boundary checks cannot be bypassed",
    );
  }
}

function refreshRunner(runner) {
  return (argv) => {
    const [command, ...args] = argv;
    const result = runner(command, args, { encoding: "utf8" });
    if (result?.status !== 0) {
      const detail = String(result?.stderr || result?.stdout || "").trim();
      throw new Error(detail || `authority_head_refresh_failed:${result?.status ?? "unknown"}`);
    }
    return String(result?.stdout || "").trim();
  };
}

function resolvedDependencies(overrides = {}) {
  const resolved = {
    attachAuthorityGrants,
    refreshExpectedHeads,
    authorizeBatchSync,
    authorityRuntimeEnvironment,
    executeMutationWithAuthority,
    mutationAuthorityRequired,
    mutationRequiresTrustedAuthority,
    planMutationWithAuthority,
    stampAuthorizedReviewVerdicts,
    ...overrides,
  };

  // Older focused tests and integrations may replace the intrinsic classifier.
  // Preserve that injection point unless they explicitly provide the new
  // effective-mode decision as well.
  if (
    Object.hasOwn(overrides, "mutationRequiresTrustedAuthority") &&
    !Object.hasOwn(overrides, "mutationAuthorityRequired")
  ) {
    resolved.mutationAuthorityRequired = (request, { execute = false } = {}) =>
      execute === true && overrides.mutationRequiresTrustedAuthority(request);
  }
  return resolved;
}

export function executeMutationDocument({
  document,
  execute = false,
  runner = boundedSpawnSync,
  env = process.env,
  readFile = undefined,
  dependencies = {},
} = {}) {
  const deps = resolvedDependencies(dependencies);
  const normalized = requestsFromMutationDocument(document);
  const effectiveEnv = deps.authorityRuntimeEnvironment({ env });
  const requests = normalized.requests;
  assertPublicMutationDocument(requests);

  if (execute) {
    for (const request of requests) {
      deps.planMutationWithAuthority(request, {
        env: effectiveEnv,
        readFile,
      });
    }

    const approvalIndexes = [];
    for (let index = 0; index < requests.length; index += 1) {
      if (
        deps.mutationAuthorityRequired(requests[index], {
          execute: true,
          env: effectiveEnv,
        }) &&
        !requests[index].authorityGrant
      ) {
        approvalIndexes.push(index);
      }
    }

    if (approvalIndexes.length > 0) {
      const approvalRequests = approvalIndexes.map((index) => requests[index]);
      const refreshed = deps.refreshExpectedHeads({
        requests: approvalRequests,
        runner: refreshRunner(runner),
      });
      const authorization = deps.authorizeBatchSync(refreshed.requests, {
        pipeName: effectiveEnv.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined,
      });
      const authorized = deps.stampAuthorizedReviewVerdicts(
        deps.attachAuthorityGrants(refreshed.requests, authorization),
      );
      for (let index = 0; index < approvalIndexes.length; index += 1) {
        requests[approvalIndexes[index]] = authorized.requests[index];
      }
    }
  }

  const completedKeys = new Set(
    Array.isArray(deps.completedOperationKeys) ? deps.completedOperationKeys : [],
  );
  const results = [];
  let partialFailure = false;

  for (const request of requests) {
    const operationKey =
      request.idempotencyKey ||
      [request.action, request.repo, request.pr ?? request.issue ?? ""].join(":");
    if (completedKeys.has(operationKey)) {
      const skipped = {
        action: request.action,
        status: "already_applied",
        outcome: "already_completed",
        skipped: true,
        operationKey,
      };
      results.push(skipped);
      deps.onReceipt?.(skipped);
      continue;
    }

    try {
      const result = deps.executeMutationWithAuthority({
        request,
        execute,
        runner,
        env: effectiveEnv,
        readFile,
      });
      const receipt = { ...result, operationKey };
      results.push(receipt);
      deps.onReceipt?.(receipt);
      if (receipt?.status === "succeeded" || receipt?.status === "already_applied") {
        completedKeys.add(operationKey);
      }
    } catch (error) {
      partialFailure = true;
      const failed = {
        action: request.action,
        status: "failed",
        error: String(error?.message || error),
        operationKey,
      };
      results.push(failed);
      deps.onReceipt?.(failed);
      break;
    }
  }

  if (normalized.singular) {
    const only = results[0];
    if (only?.status === "failed") throw new Error(only.error);
    return only;
  }
  return { batch: true, results, partialFailure };
}
