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
import {
  verifyMergeConversationSafety,
  verifyMergeStackEligibility,
} from "./merge-stack-policy.mjs";
import { actionDefinition } from "./mutation-action-registry.mjs";
import { boundedSpawnSync } from "./subprocess-policy.mjs";
import { readUserConfig, resolveAuthorityMode } from "./user-config.mjs";

const AUTHORITY_DISABLED_RECEIPT = Object.freeze({
  provenance: "authority_disabled_by_user",
  verified: false,
  reason: "trusted_authority_disabled_by_user_config",
});

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

function effectiveAuthorityMode({
  config = undefined,
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  readConfigFile = readFileSync,
} = {}) {
  const resolvedConfig =
    config === undefined
      ? readUserConfig({
          platform,
          env,
          exists,
          readFile: readConfigFile,
        }).config
      : config;
  return resolveAuthorityMode({ config: resolvedConfig, env });
}

export function mutationAuthorityOptions({
  request = {},
  enforceHighAssurance = false,
  env = process.env,
  readFile = readFileSync,
  config = undefined,
  platform = process.platform,
  exists = existsSync,
  readConfigFile = readFileSync,
} = {}) {
  const authorityMode = effectiveAuthorityMode({
    config,
    env,
    platform,
    exists,
    readConfigFile,
  });
  const legacyStrict = env.GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY === "1";
  const modeRequiresAuthority =
    enforceHighAssurance === true &&
    (authorityMode === "all" ||
      (authorityMode === "high-assurance" &&
        mutationRequiresTrustedAuthority(request)));

  return {
    authorityMode,
    authorityPublicKey: authorityMode === "off"
      ? null
      : authorityVerifierConfiguration({
          env,
          readFile,
          platform,
          exists,
        }),
    requireTrustedAuthority: authorityMode === "off"
      ? false
      : legacyStrict || modeRequiresAuthority,
  };
}

export function mutationAuthorityRequired(
  request = {},
  {
    execute = false,
    env = process.env,
    config = undefined,
    platform = process.platform,
    exists = existsSync,
    readConfigFile = readFileSync,
  } = {},
) {
  if (execute !== true) return false;
  const authorityMode = effectiveAuthorityMode({
    config,
    env,
    platform,
    exists,
    readConfigFile,
  });
  return (
    authorityMode === "all" ||
    (authorityMode === "high-assurance" &&
      mutationRequiresTrustedAuthority(request))
  );
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

function requestForAuthorityMode(request, options) {
  if (options?.authorityMode !== "off") return request;
  const normalized = {
    ...request,
    // Protection Off removes only the trusted-authority/Hello layer. Current
    // user intent still comes from controller-owned workflow context rather
    // than caller-controlled request booleans.
    explicitInstruction: options?.trustedWorkflowIntent === true,
  };
  if (
    Object.prototype.hasOwnProperty.call(normalized, "exactTextConfirmed") ||
    options?.trustedExactTextConfirmation === true
  ) {
    normalized.exactTextConfirmed = options?.trustedExactTextConfirmation === true;
  }
  delete normalized.authorityGrant;
  return normalized;
}

function receiptForAuthorityMode(value, options) {
  if (options?.authorityMode !== "off") return value;
  return {
    ...value,
    authority: { ...AUTHORITY_DISABLED_RECEIPT },
  };
}

function planWithAuthorityOptions(request, options) {
  const effectiveRequest = requestForAuthorityMode(request, options);
  const planned = planMutationRequest(effectiveRequest, options);
  assertScopedTrustedAuthority(planned.authority, options);
  return receiptForAuthorityMode(planned, options);
}

export function planMutationWithAuthority(
  request,
  {
    env = process.env,
    readFile = readFileSync,
    config = undefined,
    trustedWorkflowIntent = false,
    trustedExactTextConfirmation = false,
  } = {},
) {
  const runtimeEnv = authorityRuntimeEnvironment({ env });
  const authorityOptions = mutationAuthorityOptions({
    request,
    enforceHighAssurance: false,
    env: runtimeEnv,
    readFile,
    config,
  });
  const options = {
    ...authorityOptions,
    trustedWorkflowIntent: trustedWorkflowIntent === true,
    trustedExactTextConfirmation: trustedExactTextConfirmation === true,
  };
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
  config = undefined,
  redeemer = undefined,
  trustedWorkflowIntent = false,
  trustedExactTextConfirmation = false,
} = {}) {
  const runtimeEnv = authorityRuntimeEnvironment({ env });
  const authorityOptions = mutationAuthorityOptions({
    request,
    enforceHighAssurance: execute === true,
    env: runtimeEnv,
    readFile,
    config,
  });
  const options = {
    ...authorityOptions,
    trustedWorkflowIntent: trustedWorkflowIntent === true,
    trustedExactTextConfirmation: trustedExactTextConfirmation === true,
  };
  const effectiveRequest = requestForAuthorityMode(request, options);
  const planned = planWithAuthorityOptions(request, options);

  // Merge topology and final conversation safety are execution invariants, not
  // only workflow instructions. Conversation safety additionally proves that
  // GitHub itself enforces review-thread resolution without a bypass so a
  // thread racing the client-side recapture still blocks the server-side merge.
  const stackEligibility = execute === true
    ? verifyMergeStackEligibility({ request: planned.request, runner })
    : null;
  const conversationSafety = execute === true && planned.action === "merge_pr"
    ? verifyMergeConversationSafety({ request: planned.request, runner })
    : null;

  const pipeName = runtimeEnv.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined;
  const resolvedRedeemer = options.authorityMode === "off"
    ? null
    : redeemer === undefined
      ? pipeName
        ? makeAuthorityRedeemer({ pipeName })
        : null
      : redeemer;
  const execution = makeRedemptionRunner({
    plannedCommand: planned.command,
    authority: planned.authority,
    authorityGrant: effectiveRequest.authorityGrant,
    redeemer: resolvedRedeemer,
    runner,
  });

  try {
    const receipt = executeMutationRequest({
      request: effectiveRequest,
      execute,
      runner: execution.runner,
      ...options,
    });
    return receiptForAuthorityMode({
      ...receipt,
      stackEligibility,
      conversationSafety,
      redemption: execution.redemption(),
    }, options);
  } catch (error) {
    if (execute === true && effectiveRequest?.action === "merge_pr" && execution.attempted()) {
      try {
        const reconciled = reconcileAttemptedMerge({
          planned,
          runner: execution.runner,
        });
        if (reconciled) {
          return receiptForAuthorityMode({
            ...reconciled,
            stackEligibility,
            conversationSafety,
            redemption: execution.redemption(),
          }, options);
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
