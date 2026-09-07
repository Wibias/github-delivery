#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  appendAgentDebugTraceEvent,
  debugTraceEnabled,
} from "./lib/agent-debug-trace.mjs";
import { normalizeCursorHookDebugTraceEvent } from "./lib/cursor-debug-trace.mjs";

function inactiveResult() {
  return { recorded: false, path: null };
}

export function runCursorDebugTraceHook({
  rawInput = null,
  env = process.env,
  stateDir = null,
  stderr = process.stderr,
} = {}) {
  if (!debugTraceEnabled(env)) return inactiveResult();

  let input = rawInput;
  if (input === null) {
    try {
      input = readFileSync(0, "utf8");
    } catch (error) {
      stderr.write(`github-delivery cursor debug hook input failed: ${error?.message || error}\n`);
      return inactiveResult();
    }
  }

  let event;
  try {
    event = JSON.parse(String(input || ""));
  } catch (error) {
    stderr.write(`github-delivery cursor debug hook ignored invalid JSON: ${error?.message || error}\n`);
    return inactiveResult();
  }

  const normalized = normalizeCursorHookDebugTraceEvent(event);
  if (!normalized?.threadId) return inactiveResult();

  try {
    return appendAgentDebugTraceEvent({
      provider: "cursor",
      scopeId: normalized.threadId,
      event: normalized,
      env,
      stateDir,
    });
  } catch (error) {
    stderr.write(`github-delivery cursor debug hook trace failed: ${error?.message || error}\n`);
    return inactiveResult();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCursorDebugTraceHook();
}
