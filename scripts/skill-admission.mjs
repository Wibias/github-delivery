#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { planSkillAdmission } from "./lib/skill-admission.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/skill-admission.mjs <candidate.json>");
  process.exit(2);
}

try {
  const input = JSON.parse(readFileSync(path, "utf8"));
  const result = planSkillAdmission(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.decision === "blocked") process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
