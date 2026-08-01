#!/usr/bin/env node
import { resolve } from "node:path";

import { validateEvalRepository } from "./lib/eval-contracts.mjs";

try {
  const root = resolve(import.meta.dirname, "..");
  const report = validateEvalRepository({ root });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
