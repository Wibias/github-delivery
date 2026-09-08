#!/usr/bin/env node
import { runCursorWithDebugTrace } from "./cursor-with-debug-trace.mjs";
import { buildAgentTraceEnv } from "./lib/agent-trace-launcher.mjs";
import { isDirectExecution } from "./lib/direct-execution.mjs";

export function runCursorTrace({
  env = process.env,
  ...options
} = {}) {
  return runCursorWithDebugTrace({
    ...options,
    env: buildAgentTraceEnv(env),
  });
}

if (isDirectExecution(import.meta.url)) {
  try {
    runCursorTrace();
  } catch (error) {
    process.stderr.write(`github-delivery cursor-trace failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
