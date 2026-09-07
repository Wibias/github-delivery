#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  buildCursorDebugTraceArgs,
  normalizeCursorCliDebugTraceEvent,
} from "./lib/cursor-debug-trace.mjs";
import { runStructuredDebugCli } from "./lib/structured-debug-cli.mjs";

export function runCursorWithDebugTrace({
  cursorBin = process.env.CURSOR_AGENT_BIN || "agent",
  args = process.argv.slice(2),
  ...options
} = {}) {
  return runStructuredDebugCli({
    provider: "cursor",
    bin: cursorBin,
    args: buildCursorDebugTraceArgs(args),
    normalize: normalizeCursorCliDebugTraceEvent,
    ...options,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCursorWithDebugTrace();
  } catch (error) {
    process.stderr.write(`github-delivery cursor debug wrapper failed: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}
