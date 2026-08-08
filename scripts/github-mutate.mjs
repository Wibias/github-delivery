#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

import { executeMutationRequest } from "./lib/github-mutation-broker.mjs";

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

try {
  const args = parseArgs(process.argv.slice(2));
  const request = JSON.parse(readFileSync(args.requestPath, "utf8"));
  const receipt = executeMutationRequest({
    request,
    execute: args.execute,
    authorityPublicKey: process.env.GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY || null,
    requireTrustedAuthority:
      process.env.GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY === "1",
  });
  if (args.auditPath) {
    appendFileSync(args.auditPath, `${JSON.stringify(receipt)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
