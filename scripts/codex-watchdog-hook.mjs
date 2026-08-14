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

const PROTOCOL_QUARANTINE_SESSION_PREFIX = "github-delivery-protocol-quarantine:";

function defaultStateRoot() {
  return resolve(
    process.env.GITHUB_DELIVERY_WATCHDOG_STATE_DIR ||
      join(tmpdir(), "github-delivery-watchdog"),
  );
}

function sessionGuardScope(input) {
  return {
    sessionId: `${PROTOCOL_QUARANTINE_SESSION_PREFIX}${String(input.session_id || "unknown-session")}`,
    turnId: "github-delivery-session-protocol-quarantine",
    agentId: "watchdog",
  };
}

function stateOptions(stateRoot, options) {
  return {
    stateRoot,
    lockWaitMs: options.lockWaitMs,
    staleLockMs: options.staleLockMs,
  };
}

function sameModel(quarantine, model) {
  const quarantinedModel = String(quarantine?.model || "");
  const currentModel = String(model || "");
  return !quarantinedModel || !currentModel || quarantinedModel === currentModel;
}

function quarantineReason(quarantine) {
  const model = String(quarantine?.model || "");
  const subject = model ? `model ${model}` : "the current model";
  return (
    `This task is quarantined after repeated tool-protocol output from ${subject}. `
    + "Change model or start a new task before resuming."
  );
}

function checkSessionQuarantine(input, stateRoot, options) {
  return withWatchdogState(
    sessionGuardScope(input),
    (state) => {
      const quarantine = state.protocolQuarantine;
      if (!quarantine?.active) return { output: null, state };
      if (sameModel(quarantine, input.model)) {
        return {
          output: {
            decision: "block",
            reason: quarantineReason(quarantine),
          },
          state,
        };
      }
      return { output: null, state: {} };
    },
    stateOptions(stateRoot, options),
  );
}

function quarantineSession(input, stateRoot, options) {
  return withWatchdogState(
    sessionGuardScope(input),
    () => ({
      output: null,
      state: {
        protocolQuarantine: {
          schemaVersion: 1,
          active: true,
          model: String(input.model || ""),
          turnId: String(input.turn_id || ""),
          reason: "tool_protocol_emission_stall",
        },
      },
    }),
    stateOptions(stateRoot, options),
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

export function statePathForProtocolQuarantine(stateRoot, sessionId) {
  return watchdogStatePath(
    resolve(stateRoot),
    sessionGuardScope({ session_id: sessionId }),
  );
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

  if (input.hook_event_name === "UserPromptSubmit") {
    const result = checkSessionQuarantine(input, stateRoot, options);
    return { ...result, stateRemoved: false };
  }

  const scope = watchdogStateScope(input);
  const result = withWatchdogState(
    scope,
    (state) => evaluateCodexHook(input, state, options),
    stateOptions(stateRoot, options),
  );
  let output = result.output;
  let quarantinePersisted = null;
  if (
    input.hook_event_name === "Stop"
    && result.output?.continue === false
    && result.output?.stopReason === "tool_protocol_emission_stall"
  ) {
    try {
      quarantineSession(input, stateRoot, options);
      quarantinePersisted = true;
    } catch {
      quarantinePersisted = false;
      output = {
        ...result.output,
        systemMessage: [
          result.output.systemMessage,
          "GitHub Delivery quarantine state could not be saved. Change model or start a new task before resuming.",
        ].filter(Boolean).join(" "),
      };
    }
  }
  return {
    ...result,
    output,
    stateRemoved: false,
    ...(quarantinePersisted === null ? {} : { quarantinePersisted }),
  };
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
