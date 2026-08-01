#!/usr/bin/env node
import {
  authorizeMutation,
  mutationProfile,
  normalizeMutationMode,
} from "./lib/mutation-policy.mjs";

const usage =
  "Usage: node scripts/mutation-policy.mjs MODE [ACTION] [--explicit] [--exact-text-confirmed]";

try {
  const positionals = [];
  let explicitInstruction = false;
  let exactTextConfirmed = false;
  for (const value of process.argv.slice(2)) {
    if (value === "--explicit") explicitInstruction = true;
    else if (value === "--exact-text-confirmed") exactTextConfirmed = true;
    else if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    else positionals.push(value);
  }
  if (positionals.length < 1 || positionals.length > 2) throw new Error(usage);
  const mode = normalizeMutationMode(positionals[0]);
  const action = positionals[1] || null;
  const output = action
    ? authorizeMutation({
        mode,
        action,
        explicitInstruction,
        exactTextConfirmed,
      })
    : mutationProfile(mode);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = action && !output.allowed ? 1 : 0;
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
