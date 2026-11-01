function text(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function durationMs(event) {
  const value = Number.isFinite(event?.durationMs) ? event.durationMs : event?.duration_ms;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function terminalDiagnostics(event, status) {
  const outcome = ["completed", "complete"].includes(status) ? "succeeded" : status;
  const duration = durationMs(event);
  return {
    outcome,
    ...(duration !== null ? { durationMs: duration } : {}),
    ...(status === "failed" ? { errorKind: "tool_failed" } : {}),
  };
}

function payloadDiagnostics(diagnostics, method, value) {
  if (!diagnostics || typeof diagnostics[method] !== "function") return {};
  try {
    return diagnostics[method](value) || {};
  } catch {
    return {};
  }
}

function commonCursorIds(event) {
  const threadId = text(event?.conversation_id) || text(event?.session_id);
  const turnId = text(event?.generation_id);
  return {
    ...(threadId ? { threadId } : {}),
    ...(turnId ? { turnId } : {}),
  };
}

function toolIdentity(event) {
  const itemId =
    text(event?.tool_call_id) ||
    text(event?.tool_use_id) ||
    text(event?.call_id) ||
    text(event?.toolCallId);
  const itemType = text(event?.tool_name) || text(event?.toolName);
  return {
    ...(itemId ? { itemId } : {}),
    ...(itemType ? { itemType } : {}),
  };
}

function ownsArg(args, names) {
  return args.some((arg) => names.some((name) => arg === name || String(arg).startsWith(`${name}=`)));
}

export function buildCursorDebugTraceArgs(args = []) {
  const input = Array.from(args, (arg) => String(arg));
  if (ownsArg(input, ["--output-format"])) {
    throw new Error("Cursor debug trace wrapper owns --output-format");
  }
  if (ownsArg(input, ["--print", "-p"])) {
    throw new Error("Cursor debug trace wrapper owns --print");
  }
  if (ownsArg(input, ["--stream-partial-output"])) {
    throw new Error("Cursor debug trace wrapper owns --stream-partial-output");
  }
  return ["--print", "--output-format", "stream-json", "--stream-partial-output", ...input];
}

export function normalizeCursorCliDebugTraceEvent(event, diagnostics = null) {
  if (!event || typeof event !== "object") return null;
  const type = text(event.type);
  const subtype = text(event.subtype);
  const ids = commonCursorIds(event);

  if (type === "thinking") {
    const value =
      typeof event.text === "string"
        ? event.text
        : typeof event.delta === "string"
          ? event.delta
          : "";
    return {
      provider: "cursor",
      type: "reasoning_summary_delta",
      ...ids,
      text: value,
    };
  }

  if (type === "tool_call" && ["started", "start", "in_progress"].includes(subtype || "")) {
    const identity = toolIdentity(event);
    return {
      provider: "cursor",
      type: "item_started",
      ...ids,
      ...identity,
      ...payloadDiagnostics(diagnostics, "toolInput", {
        itemType: identity.itemType,
        input: event.args ?? event.tool_input ?? event.input,
        turnId: ids.turnId,
        itemId: identity.itemId,
      }),
    };
  }

  if (type === "tool_call" && ["completed", "complete", "failed", "cancelled"].includes(subtype || "")) {
    const identity = toolIdentity(event);
    return {
      provider: "cursor",
      type: "item_completed",
      ...ids,
      ...identity,
      ...terminalDiagnostics(event, subtype),
      ...payloadDiagnostics(diagnostics, "toolResult", {
        result: event.result ?? event.output ?? event.tool_output,
        itemId: identity.itemId,
      }),
    };
  }

  if (type === "result") {
    return {
      provider: "cursor",
      type: "turn_completed",
      ...ids,
    };
  }

  return null;
}

export function normalizeCursorHookDebugTraceEvent(event, diagnostics = null) {
  if (!event || typeof event !== "object") return null;
  const hook = text(event.hook_event_name);
  const ids = commonCursorIds(event);

  if (hook === "afterAgentThought") {
    return {
      provider: "cursor",
      type: "reasoning_summary_delta",
      ...ids,
      text: typeof event.text === "string" ? event.text : "",
    };
  }

  if (hook === "preToolUse") {
    const identity = toolIdentity(event);
    return {
      provider: "cursor",
      type: "item_started",
      ...ids,
      ...identity,
      ...payloadDiagnostics(diagnostics, "toolInput", {
        itemType: identity.itemType,
        input: event.tool_input,
        turnId: ids.turnId,
        itemId: identity.itemId,
      }),
    };
  }

  if (hook === "postToolUse" || hook === "postToolUseFailure") {
    const status = hook === "postToolUseFailure" ? "failed" : "completed";
    const identity = toolIdentity(event);
    return {
      provider: "cursor",
      type: "item_completed",
      ...ids,
      ...identity,
      ...terminalDiagnostics(event, status),
      ...payloadDiagnostics(diagnostics, "toolResult", {
        result: event.tool_output ?? event.result,
        itemId: identity.itemId,
      }),
    };
  }

  if (hook === "sessionStart") {
    return {
      provider: "cursor",
      type: "turn_started",
      ...ids,
    };
  }

  if (hook === "sessionEnd") {
    return {
      provider: "cursor",
      type: "turn_completed",
      ...ids,
    };
  }

  return null;
}
