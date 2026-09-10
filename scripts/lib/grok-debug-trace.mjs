function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function durationMs(event) {
  const value = Number.isFinite(event?.durationMs) ? event.durationMs : event?.duration_ms;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function terminalDiagnostics(event, status) {
  const outcome = status === "completed" ? "succeeded" : status;
  const duration = durationMs(event);
  return {
    outcome,
    ...(duration !== null ? { durationMs: duration } : {}),
    ...(status === "failed" ? { errorKind: "tool_failed" } : {}),
  };
}

function hasOwnedOutputFormat(args) {
  return args.some((arg) => arg === "--output-format" || String(arg).startsWith("--output-format="));
}

function isHeadless(args) {
  return args.some((arg) =>
    arg === "-p" ||
    arg === "--prompt" ||
    arg === "--prompt-file" ||
    String(arg).startsWith("--prompt=") ||
    String(arg).startsWith("--prompt-file="),
  );
}

function messageIdentity(event) {
  return {
    ...(text(event.session_id) || text(event.sessionId)
      ? { threadId: text(event.session_id) || text(event.sessionId) }
      : {}),
    ...(text(event.message?.id) ? { turnId: event.message.id } : {}),
    ...(text(event.parent_tool_use_id) || text(event.parentToolUseId)
      ? { parentItemId: text(event.parent_tool_use_id) || text(event.parentToolUseId) }
      : {}),
  };
}

function normalizeAssistantMessage(event) {
  const ids = messageIdentity(event);
  const events = [];
  for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
    if (!block || typeof block !== "object") continue;
    // `thinking` is provider internal chain-of-thought. It is deliberately
    // discarded before the generic recorder can persist any text.
    if (block.type === "thinking") continue;
    if (block.type !== "tool_use") continue;
    events.push({
      provider: "grok",
      type: "item_started",
      ...ids,
      ...(text(block.id) ? { itemId: block.id } : {}),
      ...(text(block.name) ? { itemType: block.name } : {}),
    });
  }
  return events;
}

function normalizeUserMessage(event) {
  const ids = messageIdentity(event);
  const events = [];
  for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
    if (!block || typeof block !== "object" || block.type !== "tool_result") continue;
    const failed = block.is_error === true || block.isError === true;
    events.push({
      provider: "grok",
      type: "item_completed",
      ...ids,
      ...(text(block.tool_use_id) || text(block.toolUseId)
        ? { itemId: text(block.tool_use_id) || text(block.toolUseId) }
        : {}),
      outcome: failed ? "failed" : "succeeded",
      ...(failed ? { errorKind: "tool_failed" } : {}),
    });
  }
  return events;
}

export function buildGrokDebugTraceArgs(args = []) {
  const input = Array.from(args, (arg) => String(arg));
  if (!isHeadless(input)) {
    throw new Error("Grok debug tracing requires a headless -p/--prompt/--prompt-file invocation");
  }
  if (hasOwnedOutputFormat(input)) {
    throw new Error("Grok debug trace wrapper owns --output-format");
  }
  // The message stream carries session_id and parent_tool_use_id on assistant
  // and user messages. The older streaming-json shape does not, which makes
  // nested/subagent tool activity impossible to attribute safely.
  return [...input, "--output-format", "streaming-messages-json"];
}

export function normalizeGrokDebugTraceEvent(event) {
  if (!event || typeof event !== "object") return [];
  const type = text(event.type);

  if (type === "assistant") return normalizeAssistantMessage(event);
  if (type === "user") return normalizeUserMessage(event);

  if (type === "result") {
    return [{
      provider: "grok",
      type: "turn_completed",
      ...(text(event.session_id) ? { threadId: event.session_id } : {}),
    }];
  }

  // Backward-compatible normalization for callers that still feed the older
  // streaming-json tool lifecycle. Internal `thought` text is never accepted.
  if (type === "thought") return [];

  if (type === "tool_call") {
    return [{
      provider: "grok",
      type: "item_started",
      ...(text(event.sessionId) ? { threadId: event.sessionId } : {}),
      ...(text(event.toolCallId) ? { itemId: event.toolCallId } : {}),
      ...(text(event.toolName) ? { itemType: event.toolName } : {}),
      ...(text(event.parentToolUseId) ? { parentItemId: event.parentToolUseId } : {}),
    }];
  }

  if (type === "tool_call_update") {
    const status = text(event.status);
    if (!["completed", "failed", "cancelled"].includes(status || "")) return [];
    return [{
      provider: "grok",
      type: "item_completed",
      ...(text(event.sessionId) ? { threadId: event.sessionId } : {}),
      ...(text(event.toolCallId) ? { itemId: event.toolCallId } : {}),
      ...(text(event.toolName) ? { itemType: event.toolName } : {}),
      ...(text(event.parentToolUseId) ? { parentItemId: event.parentToolUseId } : {}),
      ...terminalDiagnostics(event, status),
    }];
  }

  if (type === "end") {
    return [{
      provider: "grok",
      type: "turn_completed",
      ...(text(event.sessionId) ? { threadId: event.sessionId } : {}),
    }];
  }

  return [];
}
