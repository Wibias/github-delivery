#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { planVerificationMethods } from "./lib/verification-method-routing.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/verification-methods.mjs <review-scope-plan.json>");
  process.exit(2);
}

try {
  const plan = JSON.parse(readFileSync(path, "utf8"));
  const result = planVerificationMethods(plan);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
