#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { runGitHubCommandWithRetry } from "./lib/github-retry.mjs";
import {
  executeMutationDocument,
  mutationOperationKey,
  mutationReceiptCompleted,
} from "./lib/mutation-document-execution.mjs";
import {
  mutationExecutionContextFromCheckpoint,
  reconcileMutationCheckpoint,
} from "./lib/mutation-checkpoint.mjs";
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";
import { makeGitHubBodyTransportRunner } from "./lib/github-body-transport.mjs";

const usage =
  "Usage: node scripts/github-mutate.mjs --request FILE [--execute] [--audit FILE] [--checkpoint FILE]";
const SCOPED_OPERATION_KEY = /^(?:payload:[0-9a-f]{64}|idempotency:[0-9a-f]{64}:payload:[0-9a-f]{64})$/i;

function parseArgs(argv) {
  let requestPath = null;
  let auditPath = null;
  let checkpointPath = null;
  let execute = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--request") {
      requestPath = argv[++index];
      if (!requestPath) throw new Error("--request requires a file path");
    } else if (value === "--audit") {
      auditPath = argv[++index];
      if (!auditPath) throw new Error("--audit requires a file path");
    } else if (value === "--checkpoint") {
      checkpointPath = argv[++index];
      if (!checkpointPath) throw new Error("--checkpoint requires a file path");
    } else if (value === "--execute") {
      execute = true;
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  if (!requestPath) throw new Error(usage);
  return { requestPath, auditPath, checkpointPath, execute };
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

function completedOperationKey(receipt) {
  if (!receipt?.operationKey || !mutationReceiptCompleted(receipt)) return null;
  if (
    receipt.request &&
    typeof receipt.request === "object" &&
    !Array.isArray(receipt.request)
  ) {
    return mutationOperationKey(receipt.request);
  }
  const key = String(receipt.operationKey);
  if (SCOPED_OPERATION_KEY.test(key)) return key;
  throw new Error(`audit_operation_scope_missing:${key}`);
}

function completedKeysFromAudit(auditPath) {
  if (!auditPath || !existsSync(auditPath)) return [];
  const keys = [];
  for (const line of readFileSync(auditPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let receipt;
    try {
      receipt = JSON.parse(line);
    } catch {
      // Older audit lines may be whole-batch JSON or otherwise unreadable.
      continue;
    }
    const operationKey = completedOperationKey(receipt);
    if (operationKey) keys.push(operationKey);
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
      executionContextForRequest(request) {
        return mutationExecutionContextFromCheckpoint({
          path: args.checkpointPath,
          request,
        });
      },
      onReceipt(receipt) {
        if (!args.auditPath) return;
        appendFileSync(args.auditPath, `${JSON.stringify(receipt)}\n`, "utf8");
      },
    },
  });
  if (args.execute && args.checkpointPath) {
    reconcileMutationCheckpoint({ path: args.checkpointPath, output });
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output?.partialFailure) process.exitCode = 2;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
