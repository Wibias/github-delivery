#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import { attachAuthorityGrants } from "./lib/authority-batch.mjs";
import { authorizeBatchSync } from "./lib/authority-host-client.mjs";

const usage = "Usage: node scripts/github-authorize.mjs --request FILE [--out FILE] [--pipe NAME]";

function parseArgs(argv) {
  let requestPath = null;
  let outPath = null;
  let pipeName = process.env.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--request") {
      requestPath = argv[++index];
      if (!requestPath) throw new Error("--request requires a file path");
    } else if (value === "--out") {
      outPath = argv[++index];
      if (!outPath) throw new Error("--out requires a file path");
    } else if (value === "--pipe") {
      pipeName = argv[++index];
      if (!pipeName) throw new Error("--pipe requires a name");
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  if (!requestPath) throw new Error(usage);
  return { requestPath, outPath, pipeName };
}

function operationsFromDocument(document) {
  if (Array.isArray(document)) return document;
  if (document && typeof document === "object" && Array.isArray(document.operations)) {
    return document.operations;
  }
  throw new Error("authority_batch_operations_required");
}

try {
  const args = parseArgs(process.argv.slice(2));
  const document = JSON.parse(readFileSync(args.requestPath, "utf8"));
  const operations = operationsFromDocument(document);
  const authorization = authorizeBatchSync(operations, { pipeName: args.pipeName });
  const output = attachAuthorityGrants(operations, authorization);
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.outPath) writeFileSync(args.outPath, json, "utf8");
  else process.stdout.write(json);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
