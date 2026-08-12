import { createAppServerWatchdogRouter } from "./codex-app-server-watchdog-proxy.mjs";

function sanitizedInterrupt(request) {
  return {
    method: "turn/interrupt",
    params: {
      threadId: request?.params?.threadId || null,
      turnId: request?.params?.turnId || null,
    },
  };
}

export function replayCodexWatchdogTrace(
  messages,
  {
    router = createAppServerWatchdogRouter({ internalRequestIdPrefix: "gd-replay" }),
  } = {},
) {
  if (!Array.isArray(messages)) throw new Error("watchdog replay messages must be an array");

  const interrupts = [];
  let forwardedCount = 0;
  let firstInterruptEvent = null;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new Error(`watchdog replay event ${index + 1} must be an object`);
    }

    const routed = router.onServerMessage(message);
    if (routed.forward) forwardedCount += 1;

    for (const request of routed.internalRequests || []) {
      if (request?.method !== "turn/interrupt") continue;
      interrupts.push(sanitizedInterrupt(request));
      if (firstInterruptEvent === null) firstInterruptEvent = index + 1;
    }
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/watchdog-replay",
    eventCount: messages.length,
    forwardedCount,
    interruptCount: interrupts.length,
    firstInterruptEvent,
    interrupts,
  };
}
