#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolvePolicyBundle,
  validatePolicyArchitecture,
} from "./lib/policy-bundle.mjs";

const USAGE = "Usage: node scripts/policy-bundle.mjs <workflow> [ROOT] | --validate [ROOT]";
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const [first, second, ...rest] = process.argv.slice(2);
  if (!first || rest.length) throw new Error(USAGE);
  const root = resolve(second || DEFAULT_ROOT);
  const result =
    first === "--validate"
      ? validatePolicyArchitecture({ root })
      : resolvePolicyBundle({ root, workflow: first });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (first === "--validate" && !result.valid) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 2;
}
