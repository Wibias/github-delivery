#!/usr/bin/env node
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateCodexHook } from "./lib/codex-watchdog-hook.mjs";
import {
  removeWatchdogSessionState,
  watchdogStatePath,
  watchdogStateScope,
  withWatchdogState,
} from "./lib/watchdog-state-store.mjs";

function defaultStateRoot() {
  return resolve(
    process.env.GITHUB_DELIVERY_WATCHDOG_STATE_DIR ||
      join(tmpdir(), "github-delivery-watchdog"),
  );
}

export function statePathForSession(
  stateRoot,
  sessionId,
  turnId = "turn-1",
  agentId = "main",
) {
  return watchdogStatePath(resolve(stateRoot), {
    sessionId: String(sessionId || "unknown-session"),
    turnId: String(turnId || "unknown-turn"),
    agentId: String(agentId || "main"),
  });
}

export function runCodexWatchdogHook(input, options = {}) {
  if (!input || typeof input !== "object") throw new Error("hook input must be a JSON object");
  const stateRoot = resolve(options.stateRoot || defaultStateRoot());

  if (input.hook_event_name === "SessionEnd") {
    const removed = removeWatchdogSessionState(stateRoot, input.session_id || "unknown-session");
    return {
      output: null,
      stateRemoved: removed.existed,
      statePath: removed.directory,
    };
  }

  const scope = watchdogStateScope(input);
  const result = withWatchdogState(
    scope,
    (state) => evaluateCodexHook(input, state, options),
    {
      stateRoot,
      lockWaitMs: options.lockWaitMs,
      staleLockMs: options.staleLockMs,
    },
  );
  return { ...result, stateRemoved: false };
}

export function main({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  let raw = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk) => {
    raw += chunk;
  });
  stdin.on("end", () => {
    try {
      const input = JSON.parse(raw || "{}");
      const result = runCodexWatchdogHook(input);
      if (result.output) stdout.write(`${JSON.stringify(result.output)}\n`);
    } catch (error) {
      stderr.write(`github-delivery watchdog hook error: ${error?.message || error}\n`);
      process.exitCode = 1;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
