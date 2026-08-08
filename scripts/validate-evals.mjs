#!/usr/bin/env node
import { resolve } from "node:path";

import { validateEvalRepository } from "./lib/eval-contracts.mjs";

function workflowCommandEscape(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

try {
  const root = resolve(import.meta.dirname, "..");
  const report = validateEvalRepository({ root });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) {
    for (const error of report.errors.slice(0, 50)) {
      const title = workflowCommandEscape(`offline eval: ${error.code}`);
      const message = workflowCommandEscape(JSON.stringify(error));
      process.stdout.write(`::error title=${title}::${message}\n`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
