#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runCursorWithDebugTrace } from "./cursor-with-debug-trace.mjs";
import { buildAgentTraceEnv } from "./lib/agent-trace-launcher.mjs";

export function runCursorTrace({
  env = process.env,
  ...options
} = {}) {
  return runCursorWithDebugTrace({
    ...options,
    env: buildAgentTraceEnv(env),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCursorTrace();
  } catch (error) {
    process.stderr.write(`github-delivery cursor-trace failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
