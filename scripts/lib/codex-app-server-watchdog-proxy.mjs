import { createProgressWatchdog } from "./agent-progress-watchdog.mjs";
import { observeCodexAppServerMessage } from "./codex-progress-watchdog.mjs";

const STREAM_WATCHDOG_DEFAULTS = Object.freeze({
  generatedCharSoftLimit: 4_000,
  generatedCharHardLimit: 8_000,
  noProgressTokenSoftLimit: 1_024,
  noProgressTokenHardLimit: 2_048,
  toolEmissionIntentThreshold: 4,
});

function messageTurnId(message) {
  return message?.params?.turnId || message?.params?.turn?.id || null;
}

function messageThreadId(message) {
  return message?.params?.threadId || null;
}

function emitTelemetry(options, message, outcome = null) {
  if (typeof options.onTelemetry !== "function" || !message?.method) return;
  const event = {
    schemaVersion: 1,
    kind: "github-delivery/watchdog-stream-event",
    method: String(message.method),
    threadId: messageThreadId(message),
    turnId: messageTurnId(message),
    decision: outcome?.decision?.action || "allow",
    interrupted: Boolean(outcome?.interrupt),
  };
  try {
    options.onTelemetry(event);
  } catch {
    // Telemetry is diagnostic only and must never change enforcement behavior.
  }
}

export function createAppServerWatchdogRouter(options = {}) {
  const turns = new Map();
  const privateIds = new Map();
  const prefix = options.internalRequestIdPrefix || `github-delivery-watchdog-${process.pid}`;
  let sequence = 0;
  let providedWatchdogUsed = false;

  function createTurnState(turnId) {
    let watchdog;
    if (options.watchdog && !providedWatchdogUsed) {
      watchdog = options.watchdog;
      providedWatchdogUsed = true;
    } else if (typeof options.watchdogFactory === "function") {
      watchdog = options.watchdogFactory({ turnId });
    } else {
      watchdog = createProgressWatchdog({
        ...STREAM_WATCHDOG_DEFAULTS,
        ...options.watchdogOptions,
      });
    }
    const state = {
      watchdog,
      context: { interruptedTurns: new Set() },
      threadId: null,
    };
    turns.set(turnId, state);
    return state;
  }

  function stateFor(message) {
    const turnId = messageTurnId(message);
    if (!turnId) return null;
    const state = turns.get(turnId) || createTurnState(turnId);
    const threadId = messageThreadId(message);
    if (threadId) {
      if (state.threadId && state.threadId !== threadId) {
        throw new Error(
          `Watchdog turn ${turnId} changed thread identity from ${state.threadId} to ${threadId}`,
        );
      }
      state.threadId = threadId;
    }
    return state;
  }

  function onServerMessage(message) {
    if (message && Object.hasOwn(message, "id") && privateIds.has(message.id)) {
      const metadata = privateIds.get(message.id);
      privateIds.delete(message.id);
      if (message.error && typeof options.onInternalRequestError === "function") {
        options.onInternalRequestError({ message, metadata });
      }
      return { forward: null, internalRequests: [] };
    }

    const state = stateFor(message);
    if (!state) {
      emitTelemetry(options, message);
      return { forward: message, internalRequests: [] };
    }

    const outcome = observeCodexAppServerMessage(state.watchdog, message, state.context);
    emitTelemetry(options, message, outcome);
    const internalRequests = [];
    if (outcome.interrupt) {
      const id = `${prefix}-${++sequence}`;
      privateIds.set(id, {
        method: outcome.interrupt.method,
        turnId: messageTurnId(message),
        threadId: messageThreadId(message) || state.threadId,
      });
      internalRequests.push({ id, ...outcome.interrupt });
    }

    if (message?.method === "turn/completed") {
      turns.delete(messageTurnId(message));
    }
    return { forward: message, internalRequests };
  }

  return {
    onServerMessage,
    activeTurnCount: () => turns.size,
  };
}
