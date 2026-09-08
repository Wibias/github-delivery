#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runProtectedCodex } from "./codex-with-watchdog.mjs";
import { buildAgentTraceEnv } from "./lib/agent-trace-launcher.mjs";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
