#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { boundedSpawnSync } from "./lib/subprocess-policy.mjs";

import { attachAuthorityGrants } from "./lib/authority-batch.mjs";
import { authorizeBatchSync } from "./lib/authority-host-client.mjs";
import { refreshExpectedHeads } from "./lib/authority-head-refresh.mjs";
import { stampAuthorizedReviewVerdicts } from "./lib/review-verdict-marker.mjs";

const usage = "Usage: node scripts/github-authorize.mjs --request FILE [--out FILE] [--pipe NAME]";

function parseArgs(argv) {
  let requestPath = null;
  let outPath = null;
  let pipeName = process.env.GITHUB_DELIVERY_AUTHORITY_PIPE || undefined;
  for (let index = 0; index < argv.length; index += 1) {
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

function ghRunner(args) {
  const [executable, ...commandArgs] = args;
  const result = boundedSpawnSync(executable, commandArgs, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || `authority_head_refresh_gh_failed:${result.status}`);
  }
  return String(result.stdout || "").trim();
}

function describeRefresh(entry) {
  const shortFrom = String(entry.from).slice(0, 12);
  const shortTo = String(entry.to).slice(0, 12);
  return `PR #${entry.pr} (${entry.repo}): expected head ${shortFrom}… moved to ${shortTo}… — refreshing approval to the live head`;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const document = JSON.parse(readFileSync(args.requestPath, "utf8"));
  const operations = refreshExpectedHeads({
    requests: operationsFromDocument(document),
    runner: ghRunner,
  });
  if (operations.refreshed.length > 0) {
    process.stderr.write(
      `[github-delivery] ${operations.refreshed.length} PR head(s) changed since the request was drafted:\n`,
    );
    for (const entry of operations.refreshed) {
      process.stderr.write(`  - ${describeRefresh(entry)}\n`);
    }
    process.stderr.write(
      "[github-delivery] The approval prompt below covers the refreshed live head(s).\n",
    );
  }
  const authorization = authorizeBatchSync(operations.requests, { pipeName: args.pipeName });
  const output = stampAuthorizedReviewVerdicts(
    attachAuthorityGrants(operations.requests, authorization),
  );
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.outPath) writeFileSync(args.outPath, json, "utf8");
  else process.stdout.write(json);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
