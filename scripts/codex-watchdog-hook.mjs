#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { evaluateCodexHook } from "./lib/codex-watchdog-hook.mjs";

function defaultStateRoot() {
  return resolve(
    process.env.GITHUB_DELIVERY_WATCHDOG_STATE_DIR ||
      join(tmpdir(), "github-delivery-watchdog"),
  );
}

function sessionKey(sessionId) {
  return createHash("sha256").update(String(sessionId || "unknown")).digest("hex");
}

export function statePathForSession(stateRoot, sessionId) {
  return join(resolve(stateRoot), `${sessionKey(sessionId)}.json`);
}

function readState(path) {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function runCodexWatchdogHook(input, options = {}) {
  if (!input || typeof input !== "object") throw new Error("hook input must be a JSON object");
  const stateRoot = resolve(options.stateRoot || defaultStateRoot());
  const statePath = statePathForSession(stateRoot, input.session_id);

  if (input.hook_event_name === "SessionEnd") {
    const existed = existsSync(statePath);
    rmSync(statePath, { force: true });
    return { output: null, stateRemoved: existed, statePath };
  }

  const state = readState(statePath);
  const result = evaluateCodexHook(input, state, options);
  writeState(statePath, result.state);
  return { ...result, statePath, stateRemoved: false };
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
