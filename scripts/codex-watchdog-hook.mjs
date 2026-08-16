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
const REPEATED_STALL_STOP_REASON = "repeated_no_progress_stall_after_recovery";
const SEVERE_RECOVERY_STOP_REASON = "severe_no_progress_recovery_completed";
const HOOK_SEVERE_RECOVERY_CHAR_LIMIT = 8_000;
const QUARANTINE_STOP_REASONS = new Set([
  "tool_protocol_emission_stall",
  REPEATED_STALL_STOP_REASON,
  SEVERE_RECOVERY_STOP_REASON,
]);

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
  let failure = "repeated tool-protocol output";
  if (quarantine?.reason === REPEATED_STALL_STOP_REASON) {
    failure = "repeated no-progress narration";
  } else if (quarantine?.reason === SEVERE_RECOVERY_STOP_REASON) {
    failure = "excessive no-progress narration";
  }
  return (
    `This task is quarantined after ${failure} from ${subject}. `
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

function quarantineSession(input, stateRoot, options, reason) {
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
          reason,
        },
      },
    }),
    stateOptions(stateRoot, options),
  );
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function assistantMessageChars(input) {
  return typeof input?.last_assistant_message === "string"
    ? input.last_assistant_message.length
    : 0;
}

function applyNarrationRecoveryProbation(input, priorState, result) {
  const event = input?.hook_event_name;
  const stopEvent = event === "Stop" || event === "SubagentStop";
  const priorAttempts = nonNegativeInteger(priorState?.narrationRecoveryAttempts);
  let probation = Boolean(priorState?.narrationRecoveryProbation);
  let stopAfterRecoveredTool = Boolean(priorState?.stopAfterRecoveredTool);

  if (event === "PreToolUse" && priorAttempts > 0) probation = true;

  if (event === "PostToolUse" && stopAfterRecoveredTool) {
    const reason = "GitHub Delivery stopped after the recovered tool completed because the preceding assistant response exceeded the hook-mode no-progress budget. Change model or use protected stream mode before resuming so another large response cannot be generated before enforcement.";
    return {
      ...result,
      output: {
        continue: false,
        stopReason: SEVERE_RECOVERY_STOP_REASON,
        reason,
        systemMessage: "GitHub Delivery stopped after the recovered tool completed, before another model response could start.",
      },
      state: {
        ...result.state,
        narrationRecoveryProbation: true,
        stopAfterRecoveredTool: false,
      },
    };
  }

  if (stopEvent) {
    const currentAttempts = nonNegativeInteger(result?.state?.narrationRecoveryAttempts);
    const startedFreshRecovery = (
      priorAttempts === 0
      && currentAttempts === 1
      && result?.output?.decision === "block"
    );

    if (startedFreshRecovery && probation) {
      return {
        ...result,
        output: {
          continue: false,
          stopReason: REPEATED_STALL_STOP_REASON,
          systemMessage: "GitHub Delivery stopped a second no-progress narration stall in the same turn after an earlier recovery reached a real tool/action boundary.",
        },
        state: {
          ...result.state,
          narrationRecoveryProbation: true,
          stopAfterRecoveredTool,
        },
      };
    }

    if (
      startedFreshRecovery
      && !probation
      && assistantMessageChars(input) >= HOOK_SEVERE_RECOVERY_CHAR_LIMIT
    ) {
      stopAfterRecoveredTool = true;
    }
    if (startedFreshRecovery || priorAttempts > 0) probation = true;
  }

  return {
    ...result,
    state: {
      ...result.state,
      narrationRecoveryProbation: probation,
      stopAfterRecoveredTool,
    },
  };
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
    (state) => applyNarrationRecoveryProbation(
      input,
      state,
      evaluateCodexHook(input, state, options),
    ),
    stateOptions(stateRoot, options),
  );
  let output = result.output;
  let quarantinePersisted = null;
  const canPersistQuarantine = (
    input.hook_event_name === "Stop"
    || input.hook_event_name === "PostToolUse"
  );
  if (
    canPersistQuarantine
    && result.output?.continue === false
    && QUARANTINE_STOP_REASONS.has(result.output?.stopReason)
  ) {
    try {
      quarantineSession(input, stateRoot, options, result.output.stopReason);
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
