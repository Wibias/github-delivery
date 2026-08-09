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

export function planMutationWithAuthority(
  request,
  { env = process.env, readFile = readFileSync } = {},
) {
  return planMutationRequest(
    request,
    mutationAuthorityOptions({ env, readFile }),
  );
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
  const planned = planMutationRequest(request, options);
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
