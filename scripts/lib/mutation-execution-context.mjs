import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  executeMutationRequest,
  planMutationRequest,
} from "./github-mutation-router.mjs";
import { makeRedemptionRunner } from "./authority-execution.mjs";
import { makeAuthorityRedeemer } from "./authority-host-client.mjs";

const HIGH_ASSURANCE_ACTIONS = new Set([
  "push_code",
  "create_pr",
  "update_pr_body",
  "create_issue",
  "assign_issue",
  "resolve_thread",
  "resolve_bot_thread",
  "close_linked_issue",
  "close_pr",
  "merge_pr",
  "retarget_pr",
  "delete_head_branch",
]);

export function authorityVerifierConfiguration({
  env = process.env,
  readFile = readFileSync,
} = {}) {
  const trustStorePath = env.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE;
  if (trustStorePath) {
    return JSON.parse(readFile(trustStorePath, "utf8"));
  }
  return env.GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY || null;
}

export function mutationRequiresTrustedAuthority(request = {}) {
  return (
    String(request?.mutationMode || "").toLowerCase() === "autonomous" ||
    HIGH_ASSURANCE_ACTIONS.has(String(request?.action || ""))
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
  const options = mutationAuthorityOptions({
    request,
    enforceHighAssurance: false,
    env,
    readFile,
  });
  return planWithAuthorityOptions(request, options);
}

export function executeMutationWithAuthority({
  request,
  execute = false,
  runner = (command, args, options) => spawnSync(command, args, options),
  env = process.env,
  readFile = readFileSync,
  redeemer = undefined,
} = {}) {
  const options = mutationAuthorityOptions({
    request,
    enforceHighAssurance: execute === true,
    env,
    readFile,
  });
  const planned = planWithAuthorityOptions(request, options);
  const pipeName = env.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined;
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
}
