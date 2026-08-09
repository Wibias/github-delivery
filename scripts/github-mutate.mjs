#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import { runGitHubCommandWithRetry } from "./lib/github-retry.mjs";
import { executeMutationWithAuthority } from "./lib/mutation-execution-context.mjs";

const usage =
  "Usage: node scripts/github-mutate.mjs --request FILE [--execute] [--audit FILE]";

function parseArgs(argv) {
  let requestPath = null;
  let auditPath = null;
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
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

function mutationRunner(command, argv, options) {
  if (command !== "gh") return spawnSync(command, argv, options);
  return runGitHubCommandWithRetry(command, argv, { options });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const request = JSON.parse(readFileSync(args.requestPath, "utf8"));
  const output = executeMutationWithAuthority({
    request,
    execute: args.execute,
    runner: mutationRunner,
  });
  if (args.auditPath) {
    appendFileSync(args.auditPath, `${JSON.stringify(output)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
