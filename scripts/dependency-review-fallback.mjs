#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateDependencyReviewFallback } from "./lib/dependency-review-fallback.mjs";

function parseArgs(argv) {
  const options = { outcome: null, root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--outcome") options.outcome = argv[++index];
    else if (argv[index] === "--root") options.root = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!options.outcome) throw new Error("--outcome is required");
  options.root = resolve(options.root);
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = evaluateDependencyReviewFallback(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Dependency Review\n\nDecision: \`${report.decision}\`\n\n${report.reason || "GitHub dependency review completed successfully."}\n`,
    );
  }
  if (report.decision === "blocked") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) }, null, 2)}\n`);
  process.exitCode = 1;
}
