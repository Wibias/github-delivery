import { createProgressWatchdog } from "./watchdog-investigation-progress.mjs";
import { observeCodexAppServerMessage } from "./codex-progress-watchdog.mjs";

const STREAM_WATCHDOG_DEFAULTS = Object.freeze({
  generatedCharSoftLimit: 4_000,
  generatedCharHardLimit: 8_000,
  noProgressTokenSoftLimit: 1_024,
  noProgressTokenHardLimit: 2_048,
  toolEmissionIntentThreshold: 6,
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

  function route(message) {
    const state = stateFor(message);
    if (!state) return { messages: [message], interrupt: null };
    const outcome = observeCodexAppServerMessage(state.watchdog, message, state.context);
    emitTelemetry(options, message, outcome);
    if (!outcome.interrupt) return { messages: [message], interrupt: null };

    sequence += 1;
    const privateId = `${prefix}-${sequence}`;
    privateIds.set(privateId, {
      threadId: outcome.interrupt.params.threadId,
      turnId: outcome.interrupt.params.turnId,
    });
    return {
      messages: [
        message,
        {
          id: privateId,
          method: outcome.interrupt.method,
          params: outcome.interrupt.params,
        },
      ],
      interrupt: {
        ...outcome.interrupt,
        id: privateId,
      },
    };
  }

  function absorbClientResponse(message) {
    const id = message?.id;
    if (!id || !privateIds.has(String(id))) return false;
    privateIds.delete(String(id));
    return true;
  }

  return {
    route,
    absorbClientResponse,
  };
}
