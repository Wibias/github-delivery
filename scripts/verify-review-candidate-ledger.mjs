#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { finalizeCandidateLedgerForVerdict } from "./lib/review-candidate-ledger.mjs";

const usage = "Usage: node scripts/verify-review-candidate-ledger.mjs LEDGER.json --expected-head SHA";

try {
  const args = process.argv.slice(2);
  const ledgerPath = args[0];
  const headIndex = args.indexOf("--expected-head");
  const expectedHead = headIndex >= 0 ? args[headIndex + 1] : null;
  if (!ledgerPath || !expectedHead) throw new Error(usage);

  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const result = finalizeCandidateLedgerForVerdict(ledger, expectedHead);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ready ? 0 : 1;
} catch (error) {
  console.error(String(error?.message || error));
  process.exitCode = 2;
}
