#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildCreatePrPublicationPlan } from "./lib/create-pr-publication-plan.mjs";
import { isDirectInvocation } from "./lib/direct-invocation.mjs";
import {
  lockCreatePrPublicationPlanCheckpoint,
  replanCreatePrPublicationPlanCheckpoint,
} from "./lib/mutation-checkpoint.mjs";

const USAGE =
  "Usage: node scripts/create-pr-publication-plan.mjs --input FILE [--output FILE] [--replan --reason TEXT]";

function parseArgs(argv) {
  let input = null;
  let output = null;
  let replan = false;
  let reason = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") {
      input = argv[++index];
      if (!input) throw new Error("--input requires a file path");
    } else if (value === "--output") {
      output = argv[++index];
      if (!output) throw new Error("--output requires a file path");
    } else if (value === "--replan") {
      replan = true;
    } else if (value === "--reason") {
      reason = argv[++index];
      if (!reason) throw new Error("--reason requires text");
    } else {
      throw new Error(`Unknown option: ${value}\n${USAGE}`);
    }
  }
  if (!input) throw new Error(USAGE);
  return {
    input: resolve(input),
    output: output ? resolve(output) : null,
    replan,
    reason,
  };
}

export function planFromFile(path) {
  const parsed = JSON.parse(readFileSync(resolve(path), "utf8"));
  return buildCreatePrPublicationPlan(parsed);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = planFromFile(args.input);
  const checkpoint = String(plan?.execute?.checkpoint || "").trim();
  if (!checkpoint) throw new Error("create_pr_publication_checkpoint_required");
  if (args.replan) {
    replanCreatePrPublicationPlanCheckpoint({
      path: resolve(checkpoint),
      plan,
      reason: args.reason,
    });
  } else {
    lockCreatePrPublicationPlanCheckpoint({ path: resolve(checkpoint), plan });
  }
  const json = `${JSON.stringify(plan, null, 2)}\n`;
  process.stdout.write(json);
  if (args.output) writeFileSync(args.output, json, "utf8");
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 2;
  }
}
