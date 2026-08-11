import {
  compactToolOutput,
  createProgressWatchdog,
} from "./agent-progress-watchdog.mjs";

const VOLATILE_NAME = /(checks?|workflow|run|status|mergeable|pull_request|pr_)/i;
const READ_NAME = /(?:^|__|_)(fetch|get|list|search|read|view|status|diff|compare)(?:_|$)/i;
const WRITE_NAME = /(?:^|__|_)(create|update|delete|remove|merge|reply|push|close|reopen|mark|set|add|apply|write)(?:_|$)/i;

function bashClassification(command) {
  const value = String(command || "").trim().toLowerCase();
  if (!value) return { kind: "unknown" };

  if (/\bgh\s+(?:pr\s+(?:checks|view)|run\s+view|api\b)/i.test(value)) {
    return { kind: "read", volatility: "volatile" };
  }
  if (
    /^(?:get-content\b|select-string\b|rg\b|grep\b|cat\b|git\s+(?:status|diff|log|show|branch|rev-parse)\b)/i.test(
      value,
    )
  ) {
    return { kind: "read", volatility: "stable" };
  }
  if (/\b(?:git\s+(?:commit|push|merge|rebase|checkout|switch|reset)|gh\s+(?:pr\s+(?:create|edit|merge|ready|close)|issue\s+(?:create|edit|close)))\b/i.test(value)) {
    return { kind: "write" };
  }
  return { kind: "unknown" };
}

export function classifyCodexTool(toolName, toolInput = {}) {
  const name = String(toolName || "");
  if (name === "Bash") return bashClassification(toolInput?.command);
  if (/^(?:apply_patch|Edit|Write)$/i.test(name)) return { kind: "write" };
  if (name === "Agent" || /spawn_agent/i.test(name)) return { kind: "progress" };
  if (WRITE_NAME.test(name)) return { kind: "write" };
  if (READ_NAME.test(name)) {
    return {
      kind: "read",
      volatility: VOLATILE_NAME.test(name) ? "volatile" : "stable",
    };
  }
  return { kind: "unknown" };
}

function hydrate(state, options) {
  const snapshot = state?.watchdog || state || {};
  return createProgressWatchdog({
    stateGeneration: snapshot.stateGeneration,
    reads: snapshot.reads,
    volatileReadIntervalMs: options.volatileReadIntervalMs,
  });
}

function stateOf(watchdog) {
  return { watchdog: watchdog.snapshot() };
}

function duplicateReason(decision) {
  if (decision.reason === "poll_too_soon") {
    return `Repeated volatile poll blocked for ${decision.retryAfterMs}ms. Reuse the current snapshot; when pending CI is the only blocker use scripts/ci-wait.mjs instead of manual polling.`;
  }
  return "Duplicate read blocked on unchanged state. Reuse the valid evidence already captured; read again only after relevant state changes or the prior result becomes failed, ambiguous, or stale.";
}

export function evaluateCodexHook(input, state = {}, options = {}) {
  const config = {
    now: options.now ?? Date.now(),
    volatileReadIntervalMs: options.volatileReadIntervalMs ?? 30_000,
    maxToolOutputChars: options.maxToolOutputChars ?? 4_000,
  };
  const watchdog = hydrate(state, config);
  const event = input?.hook_event_name;
  let output = null;

  if (event === "PreToolUse") {
    const classification = classifyCodexTool(input.tool_name, input.tool_input);
    if (classification.kind === "read") {
      const decision = watchdog.decideRead({
        toolName: input.tool_name,
        input: input.tool_input,
        volatility: classification.volatility,
        now: config.now,
      });
      if (decision.action === "block") {
        output = { decision: "block", reason: duplicateReason(decision) };
      }
    }
  } else if (event === "PostToolUse") {
    const classification = classifyCodexTool(input.tool_name, input.tool_input);
    if (classification.kind === "write") watchdog.recordStateChange("tool_write_completed");
    else watchdog.recordExternalProgress({ kind: "tool_completed", toolName: input.tool_name });

    const compacted = compactToolOutput(input.tool_response ?? "", {
      maxChars: config.maxToolOutputChars,
    });
    if (compacted.truncated) {
      output = {
        continue: false,
        stopReason: `tool_output_compacted: ${compacted.originalChars} chars -> ${compacted.text.length} chars; omitted ${compacted.omittedChars}. Omitted content is not positive evidence.\n${compacted.text}`,
      };
    }
  } else if (event === "Stop") {
    const decision = watchdog.observeAssistantDelta(input.last_assistant_message || "");
    if (decision.action === "interrupt") {
      if (input.stop_hook_active) {
        output = {
          continue: false,
          stopReason: "no_progress_stall_after_corrective_continuation",
          systemMessage: "GitHub Delivery stopped a repeated no-progress narration stall.",
        };
      } else {
        output = {
          decision: "block",
          reason: "GitHub Delivery detected a no-progress narration stall. Do not restate the plan. Execute the already-selected tool call/action if authorised, otherwise report the concrete blocker.",
        };
      }
    }
  }

  return { output, state: stateOf(watchdog) };
}
