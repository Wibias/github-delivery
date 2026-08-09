import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  executeMutationRequest,
  planMutationRequest,
} from "./github-mutation-broker.mjs";
import { makeRedemptionRunner } from "./authority-execution.mjs";
import { makeAuthorityRedeemer } from "./authority-host-client.mjs";

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

export function mutationAuthorityOptions({
  env = process.env,
  readFile = readFileSync,
} = {}) {
  return {
    authorityPublicKey: authorityVerifierConfiguration({ env, readFile }),
    requireTrustedAuthority:
      env.GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY === "1",
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
  const options = mutationAuthorityOptions({ env, readFile });
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
  const options = mutationAuthorityOptions({ env, readFile });
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
