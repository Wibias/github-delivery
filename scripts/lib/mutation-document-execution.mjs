import { attachAuthorityGrants } from "./authority-batch.mjs";
import { refreshExpectedHeads } from "./authority-head-refresh.mjs";
import { authorizeBatchSync } from "./authority-host-client.mjs";
import {
  authorityRuntimeEnvironment,
  executeMutationWithAuthority,
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
  return {
    attachAuthorityGrants,
    refreshExpectedHeads,
    authorizeBatchSync,
    authorityRuntimeEnvironment,
    executeMutationWithAuthority,
    mutationRequiresTrustedAuthority,
    planMutationWithAuthority,
    stampAuthorizedReviewVerdicts,
    ...overrides,
  };
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
        deps.mutationRequiresTrustedAuthority(requests[index]) &&
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

  const results = [];
  for (const request of requests) {
    results.push(
      deps.executeMutationWithAuthority({
        request,
        execute,
        runner,
        env: effectiveEnv,
        readFile,
      }),
    );
  }
  if (normalized.singular) return results[0];
  return { batch: true, results };
}
