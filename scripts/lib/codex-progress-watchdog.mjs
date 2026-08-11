const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "webSearch",
]);

export function observeCodexAppServerMessage(watchdog, message, context = {}) {
  if (!watchdog || typeof watchdog.observeAssistantDelta !== "function") {
    throw new Error("watchdog is required");
  }
  if (!context.interruptedTurns) context.interruptedTurns = new Set();
  if (!message || typeof message !== "object") return { decision: { action: "allow" } };

  const { method, params = {} } = message;
  if (method === "turn/started") {
    watchdog.recordExternalProgress({ kind: "turn_started" });
    return { decision: { action: "allow" } };
  }

  if (method === "item/agentMessage/delta") {
    const decision = watchdog.observeAssistantDelta(params.delta || "");
    const threadId = params.threadId;
    const turnId = params.turnId;
    if (
      decision.action === "interrupt" &&
      threadId &&
      turnId &&
      !context.interruptedTurns.has(turnId)
    ) {
      context.interruptedTurns.add(turnId);
      return {
        decision,
        interrupt: {
          method: "turn/interrupt",
          params: { threadId, turnId },
        },
      };
    }
    return { decision };
  }

  if (method === "item/started" || method === "item/completed") {
    const item = params.item;
    if (item && TOOL_ITEM_TYPES.has(item.type)) {
      watchdog.recordExternalProgress({ kind: method, toolName: item.type });
      if (method === "item/completed" && item.type === "fileChange") {
        watchdog.recordStateChange("codex_file_change_completed");
      }
    }
  }

  if (method === "turn/completed" && params.turn?.id) {
    context.interruptedTurns.delete(params.turn.id);
  }

  return { decision: { action: "allow" } };
}
