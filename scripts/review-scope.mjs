#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { collectPrReviewInput, planReviewScope } from "./lib/review-scope.mjs";

function parse(argv) {
  if (argv[0] === "--input" && argv[1]) return { input: JSON.parse(readFileSync(argv[1], "utf8")) };
  const [repo, raw] = argv;
  const pr = Number(raw);
  if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) {
    throw new Error("Usage: node scripts/review-scope.mjs OWNER/REPO PR_NUMBER | --input FILE");
  }
  return { input: collectPrReviewInput(repo, pr) };
}

try {
  const { input } = parse(process.argv.slice(2));
  process.stdout.write(JSON.stringify(planReviewScope(input), null, 2) + "\n");
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
