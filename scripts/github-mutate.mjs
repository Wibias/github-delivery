#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import {
  executeMutationRequest,
  planMutationRequest,
} from "./lib/github-mutation-broker.mjs";
import { makeRedemptionRunner } from "./lib/authority-execution.mjs";
import { makeAuthorityRedeemer } from "./lib/authority-host-client.mjs";

const usage =
  "Usage: node scripts/github-mutate.mjs --request FILE [--execute] [--audit FILE]";

function parseArgs(argv) {
  let requestPath = null;
  let auditPath = null;
  let execute = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--request") {
      requestPath = argv[++index];
      if (!requestPath) throw new Error("--request requires a file path");
    } else if (value === "--audit") {
      auditPath = argv[++index];
      if (!auditPath) throw new Error("--audit requires a file path");
    } else if (value === "--execute") {
      execute = true;
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  if (!requestPath) throw new Error(usage);
  return { requestPath, auditPath, execute };
}

function authorityVerifierConfiguration() {
  const trustStorePath = process.env.GITHUB_DELIVERY_AUTHORITY_TRUST_STORE;
  if (trustStorePath) {
    const trustStore = JSON.parse(readFileSync(trustStorePath, "utf8"));
    return trustStore;
  }
  return process.env.GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY || null;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const request = JSON.parse(readFileSync(args.requestPath, "utf8"));
  const authorityPublicKey = authorityVerifierConfiguration();
  const options = {
    authorityPublicKey,
    requireTrustedAuthority:
      process.env.GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY === "1",
  };

  const planned = planMutationRequest(request, options);
  const pipeName = process.env.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined;
  const redeemer = pipeName ? makeAuthorityRedeemer({ pipeName }) : null;
  const execution = makeRedemptionRunner({
    plannedCommand: planned.command,
    authority: planned.authority,
    authorityGrant: request.authorityGrant,
    redeemer,
    runner: (command, argv, runnerOptions) => spawnSync(command, argv, runnerOptions),
  });

  const receipt = executeMutationRequest({
    request,
    execute: args.execute,
    runner: execution.runner,
    ...options,
  });
  const output = {
    ...receipt,
    redemption: execution.redemption(),
  };
  if (args.auditPath) {
    appendFileSync(args.auditPath, `${JSON.stringify(output)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
