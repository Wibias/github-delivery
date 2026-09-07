#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  buildGrokDebugTraceArgs,
  normalizeGrokDebugTraceEvent,
} from "./lib/grok-debug-trace.mjs";
import { runStructuredDebugCli } from "./lib/structured-debug-cli.mjs";

export function runGrokWithDebugTrace({
  grokBin = process.env.GROK_BIN || "grok",
  args = process.argv.slice(2),
  ...options
} = {}) {
  return runStructuredDebugCli({
    provider: "grok",
    bin: grokBin,
    args: buildGrokDebugTraceArgs(args),
    normalize: normalizeGrokDebugTraceEvent,
    ...options,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runGrokWithDebugTrace();
  } catch (error) {
    process.stderr.write(`github-delivery grok debug wrapper failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
