#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runGrokWithDebugTrace } from "./grok-with-debug-trace.mjs";
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runGrokTrace();
  } catch (error) {
    process.stderr.write(`github-delivery grok-trace failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
