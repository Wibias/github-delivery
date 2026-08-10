#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { planOptionalAdapter } from "./lib/optional-external-adapters.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/optional-adapter-plan.mjs <request.json>");
  process.exit(2);
}

try {
  const input = JSON.parse(readFileSync(path, "utf8"));
  const plan = planOptionalAdapter(input);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (plan.status === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
