#!/usr/bin/env node
import { runGrokWithDebugTrace } from "./grok-with-debug-trace.mjs";
import { isDirectExecution } from "./lib/direct-execution.mjs";
import {
  buildGrokTraceEnv,
  buildGrokTraceLauncherArgs,
} from "./lib/grok-trace-launcher.mjs";

export function runGrokTrace({
  args = process.argv.slice(2),
  env = process.env,
  ...options
} = {}) {
  return runGrokWithDebugTrace({
    ...options,
    args: buildGrokTraceLauncherArgs(args),
    env: buildGrokTraceEnv(env),
  });
}

if (isDirectExecution(import.meta.url)) {
  try {
    runGrokTrace();
  } catch (error) {
    process.stderr.write(`github-delivery grok-trace failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
