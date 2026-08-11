import { createProgressWatchdog } from "./agent-progress-watchdog.mjs";
import { observeCodexAppServerMessage } from "./codex-progress-watchdog.mjs";

export function createAppServerWatchdogRouter(options = {}) {
  const watchdog = options.watchdog || createProgressWatchdog(options.watchdogOptions);
  const context = { interruptedTurns: new Set() };
  const privateIds = new Set();
  const prefix = options.internalRequestIdPrefix || `github-delivery-watchdog-${process.pid}`;
  let sequence = 0;

  function onServerMessage(message) {
    if (message && Object.hasOwn(message, "id") && privateIds.has(message.id)) {
      privateIds.delete(message.id);
      return { forward: null, internalRequests: [] };
    }

    const outcome = observeCodexAppServerMessage(watchdog, message, context);
    const internalRequests = [];
    if (outcome.interrupt) {
      const id = `${prefix}-${++sequence}`;
      privateIds.add(id);
      internalRequests.push({ id, ...outcome.interrupt });
    }
    return { forward: message, internalRequests };
  }

  return { onServerMessage };
}
