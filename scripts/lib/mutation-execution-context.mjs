import { existsSync, readFileSync } from "node:fs";
import { win32 as win32Path } from "node:path";

import {
  executeMutationRequest,
  planMutationRequest,
} from "./github-mutation-router.mjs";
import { makeRedemptionRunner } from "./authority-execution.mjs";
import {
  DEFAULT_AUTHORITY_PIPE,
  makeAuthorityRedeemer,
} from "./authority-host-client.mjs";
import { classifyMergeOutcome, readMergeState } from "./merge-outcome.mjs";
import { actionDefinition } from "./mutation-action-registry.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";

export function authorityRuntimeEnvironment({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  const resolved = { ...env };
  if (platform !== "win32") return resolved;

  if (!resolved.GITHUB_DELIVERY_AUTHORITY_PIPE) {
    resolved.GITHUB_DELIVERY_AUTHORITY_PIPE = DEFAULT_AUTHORITY_PIPE;
  }

  if (
    !resolved.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE &&
    !resolved.GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY &&
    resolved.LOCALAPPDATA
  ) {
    const candidate = win32Path.join(
      String(resolved.LOCALAPPDATA),
      "GitHubDeliveryAuthority",
      "trust-store.json",
    );
    if (exists(candidate)) {
      resolved.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE = candidate;
    }
  }

  return resolved;
}

export function authorityVerifierConfiguration({
  env = process.env,
  readFile = readFileSync,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  const resolvedEnv = authorityRuntimeEnvironment({ env, platform, exists });
  const trustStorePath = resolvedEnv.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE;
  if (trustStorePath) {
    return JSON.parse(readFile(trustStorePath, "utf8"));
  }
  return resolvedEnv.GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY || null;
}

export function mutationRequiresTrustedAuthority(request = {}) {
  const action = String(request?.action || "");
  return (
    String(request?.mutationMode || "").toLowerCase() === "autonomous" ||
    actionDefinition(action)?.highAssurance === true
  );
}

export function mutationAuthorityOptions({
  request = {},
  enforceHighAssurance = false,
  env = process.env,
  readFile = readFileSync,
} = {}) {
  return {
    authorityPublicKey: authorityVerifierConfiguration({ env, readFile }),
    requireTrustedAuthority:
      env.GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY === "1" ||
      (enforceHighAssurance && mutationRequiresTrustedAuthority(request)),
  };
}

export function assertScopedTrustedAuthority(
  authority,
  { requireTrustedAuthority = false } = {},
) {
  if (
    requireTrustedAuthority &&
    authority?.verified === true &&
    !authority?.claims?.scopeSha256
  ) {
    throw new Error("trusted_authority_required:scope_hash_missing");
  }
  return authority;
}

function planWithAuthorityOptions(request, options) {
  const planned = planMutationRequest(request, options);
  assertScopedTrustedAuthority(planned.authority, options);
  return planned;
}

export function planMutationWithAuthority(
  request,
  { env = process.env, readFile = readFileSync } = {},
) {
  const runtimeEnv = authorityRuntimeEnvironment({ env });
  const options = mutationAuthorityOptions({
    request,
    enforceHighAssurance: false,
    env: runtimeEnv,
    readFile,
  });
  return planWithAuthorityOptions(request, options);
}

export function reconcileAttemptedMerge({ planned, runner } = {}) {
  if (planned?.action !== "merge_pr") return null;
  const verification = readMergeState({ request: planned.request, runner });
  const outcome = classifyMergeOutcome(verification);
  if (!outcome) return null;
  return {
    ...planned,
    executed: true,
    status: "reconciled_after_error",
    outcome,
    observedHead: verification.headRefOid,
    observedBase: null,
    threadTarget: null,
    commentEditTarget: null,
    existingMutation: null,
    idempotencyClaim: null,
    stdout: "",
    verification,
  };
}

export function executeMutationWithAuthority({
  request,
  execute = false,
  runner = boundedSpawnSync,
  env = process.env,
  readFile = readFileSync,
  redeemer = undefined,
} = {}) {
  const runtimeEnv = authorityRuntimeEnvironment({ env });
  const options = mutationAuthorityOptions({
    request,
    enforceHighAssurance: execute === true,
    env: runtimeEnv,
    readFile,
  });
  const planned = planWithAuthorityOptions(request, options);
  const pipeName = runtimeEnv.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined;
  const resolvedRedeemer =
    redeemer === undefined
      ? pipeName
        ? makeAuthorityRedeemer({ pipeName })
        : null
      : redeemer;
  const execution = makeRedemptionRunner({
    plannedCommand: planned.command,
    authority: planned.authority,
    authorityGrant: request.authorityGrant,
    redeemer: resolvedRedeemer,
    runner,
  });

  try {
    const receipt = executeMutationRequest({
      request,
      execute,
      runner: execution.runner,
      ...options,
    });
    return {
      ...receipt,
      redemption: execution.redemption(),
    };
  } catch (error) {
    if (execute === true && request?.action === "merge_pr" && execution.attempted()) {
      try {
        const reconciled = reconcileAttemptedMerge({
          planned,
          runner: execution.runner,
        });
        if (reconciled) {
          return {
            ...reconciled,
            redemption: execution.redemption(),
          };
        }
      } catch (reconciliationError) {
        throw new AggregateError(
          [error, reconciliationError],
          "merge_outcome_unknown_after_write_attempt",
        );
      }
      throw new AggregateError(
        [error],
        "merge_outcome_unknown_after_write_attempt",
      );
    }
    throw error;
  }
}
