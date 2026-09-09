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

export function buildGrokDebugTraceArgs(args = []) {
  const input = Array.from(args, (arg) => String(arg));
  if (!isHeadless(input)) {
    throw new Error("Grok debug tracing requires a headless -p/--prompt/--prompt-file invocation");
  }
  if (hasOwnedOutputFormat(input)) {
    throw new Error("Grok debug trace wrapper owns --output-format");
  }
  return [...input, "--output-format", "streaming-json"];
}

export function normalizeGrokDebugTraceEvent(event) {
  if (!event || typeof event !== "object") return null;
  const type = text(event.type);

  if (type === "thought") {
    return {
      provider: "grok",
      type: "reasoning_summary_delta",
      text: typeof event.data === "string" ? event.data : "",
    };
  }

  if (type === "tool_call") {
    return {
      provider: "grok",
      type: "item_started",
      ...(text(event.toolCallId) ? { itemId: event.toolCallId } : {}),
      ...(text(event.toolName) ? { itemType: event.toolName } : {}),
    };
  }

  if (type === "tool_call_update") {
    const status = text(event.status);
    if (!["completed", "failed", "cancelled"].includes(status || "")) return null;
    return {
      provider: "grok",
      type: "item_completed",
      ...(text(event.toolCallId) ? { itemId: event.toolCallId } : {}),
      ...(text(event.toolName) ? { itemType: event.toolName } : {}),
      ...terminalDiagnostics(event, status),
    };
  }

  if (type === "end") {
    return {
      provider: "grok",
      type: "turn_completed",
      ...(text(event.sessionId) ? { threadId: event.sessionId } : {}),
    };
  }

  return null;
}
