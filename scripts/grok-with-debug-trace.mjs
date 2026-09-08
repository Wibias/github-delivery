#!/usr/bin/env node
import { isDirectExecution } from "./lib/direct-execution.mjs";
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

if (isDirectExecution(import.meta.url)) {
  try {
    runGrokWithDebugTrace();
  } catch (error) {
    process.stderr.write(`github-delivery grok debug wrapper failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
