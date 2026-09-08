#!/usr/bin/env node
import { runProtectedCodex } from "./codex-with-watchdog.mjs";
import { buildAgentTraceEnv } from "./lib/agent-trace-launcher.mjs";
import { isDirectExecution } from "./lib/direct-execution.mjs";

export function runCodexTrace({
  env = process.env,
  ...options
} = {}) {
  return runProtectedCodex({
    ...options,
    env: buildAgentTraceEnv(env),
  });
}

export async function main() {
  try {
    const result = await runCodexTrace();
    if (result.signal) {
      process.stderr.write(`github-delivery codex-trace exited on ${result.signal}\n`);
      process.kill(process.pid, result.signal);
      return;
    } else {
      process.exitCode = Number.isInteger(result.code) ? result.code : 1;
    }
  } catch (error) {
    process.stderr.write(`github-delivery codex-trace failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution(import.meta.url)) {
  await main();
}
