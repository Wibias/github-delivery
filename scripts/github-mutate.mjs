#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { runGitHubCommandWithRetry } from "./lib/github-retry.mjs";
import { executeMutationDocument } from "./lib/mutation-document-execution.mjs";
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { makeGitHubBodyTransportRunner } from "./lib/github-body-transport.mjs";

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

export function mutationRunner(command, argv, options) {
  if (command !== "gh") return boundedSpawnSync(command, argv, options);
  return makeGitHubBodyTransportRunner((cmd, args, opts) =>
    runGitHubCommandWithRetry(cmd, args, {
      options: opts,
      runner: boundedSpawnSync,
    }),
  )(command, argv, options);
}

function completedKeysFromAudit(auditPath) {
  if (!auditPath || !existsSync(auditPath)) return [];
  const keys = [];
  for (const line of readFileSync(auditPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const receipt = JSON.parse(line);
      if (
        receipt?.operationKey &&
        (receipt.status === "succeeded" || receipt.status === "already_applied")
      ) {
        keys.push(String(receipt.operationKey));
      }
    } catch {
      // Older audit lines may be whole-batch JSON; skip unreadable receipts.
    }
  }
  return keys;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const document = JSON.parse(readFileSync(args.requestPath, "utf8"));
  const output = executeMutationDocument({
    document,
    execute: args.execute,
    runner: mutationRunner,
    dependencies: {
      completedOperationKeys: completedKeysFromAudit(args.auditPath),
      onReceipt(receipt) {
        if (!args.auditPath) return;
        appendFileSync(args.auditPath, `${JSON.stringify(receipt)}\n`, "utf8");
      },
    },
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output?.partialFailure) process.exitCode = 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
