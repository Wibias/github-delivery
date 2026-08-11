import {
  compactToolOutput,
  createProgressWatchdog,
} from "./agent-progress-watchdog.mjs";
import { classifyHookTool } from "./watchdog-progress-classifier.mjs";

export function classifyCodexTool(toolName, toolInput = {}) {
  const classification = classifyHookTool({ tool_name: toolName, tool_input: toolInput });
  if (classification.kind === "evidence") {
    return { kind: "read", volatility: classification.volatility || "stable" };
  }
  if (classification.kind === "state-change") return { kind: "write" };
  if (classification.kind === "delegate") return { kind: "delegate" };
  return { kind: "unknown" };
}

function hydrate(state, options) {
  const snapshot = state?.watchdog || state || {};
  return createProgressWatchdog({
    stateGeneration: snapshot.stateGeneration,
    reads: snapshot.reads,
    consecutiveEvidenceAttempts: snapshot.consecutiveEvidenceAttempts,
    totalEvidenceAttempts: snapshot.totalEvidenceAttempts,
    evidenceWarningIssued: snapshot.evidenceWarningIssued,
    executionProgressCount: snapshot.executionProgressCount,
    stateProgressCount: snapshot.stateProgressCount,
    volatileReadIntervalMs: options.volatileReadIntervalMs,
    evidenceSoftLimit: options.evidenceSoftLimit,
    evidenceHardLimit: options.evidenceHardLimit,
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

function evidenceBudgetReason(decision) {
  return `Evidence exploration budget exhausted after ${decision.consecutiveEvidenceAttempts} consecutive reads/searches without execution or state progress. Synthesise the evidence already gathered and take the next focused execution step, make the authorised change, or report the concrete blocker before reading more.`;
}

function evidenceWarning(decision) {
  return `GitHub Delivery progress guard: ${decision.consecutiveEvidenceAttempts} consecutive evidence reads/searches have occurred without execution or state progress. Synthesise what is already known and choose the next focused action; any additional reading should be narrowly justified.`;
}

function inputChars(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return String(value ?? "").length;
  }
}

function stopDecision(watchdog, input) {
  const decision = watchdog.observeAssistantDelta(input.last_assistant_message || "");
  if (decision.action !== "interrupt") return null;
  if (input.stop_hook_active) {
    return {
      continue: false,
      stopReason: "no_progress_stall_after_corrective_continuation",
      systemMessage: "GitHub Delivery stopped a repeated no-progress narration stall.",
    };
  }
  return {
    decision: "block",
    reason: "GitHub Delivery detected a no-progress narration stall. Do not restate the plan. Execute the already-selected tool call/action if authorised, otherwise report the concrete blocker.",
  };
}

export function evaluateCodexHook(input, state = {}, options = {}) {
  const config = {
    now: options.now ?? Date.now(),
    volatileReadIntervalMs: options.volatileReadIntervalMs ?? 30_000,
    maxToolOutputChars: options.maxToolOutputChars ?? 4_000,
    maxSubagentInputChars: options.maxSubagentInputChars ?? 6_000,
    evidenceSoftLimit: options.evidenceSoftLimit ?? 8,
    evidenceHardLimit: options.evidenceHardLimit ?? 12,
  };
  const watchdog = hydrate(state, config);
  const event = input?.hook_event_name;
  let output = null;

  if (event === "PreToolUse") {
    const classification = classifyHookTool(input);
    if (classification.kind === "evidence") {
      const read = {
        toolName: input.tool_name,
        input: input.tool_input,
        volatility: classification.volatility || "stable",
        now: config.now,
      };
      const readDecision = watchdog.decideRead({ ...read, record: false });
      if (readDecision.action === "block") {
        output = { decision: "block", reason: duplicateReason(readDecision) };
      } else {
        const budgetDecision = watchdog.chargeEvidenceAttempt();
        if (budgetDecision.action === "block") {
          output = {
            decision: "block",
            reason: evidenceBudgetReason(budgetDecision),
          };
        } else {
          watchdog.decideRead({ ...read, record: true });
          if (budgetDecision.action === "warn") {
            output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext: evidenceWarning(budgetDecision),
              },
            };
          }
        }
      }
    } else if (
      classification.kind === "delegate" &&
      inputChars(input.tool_input) > config.maxSubagentInputChars
    ) {
      output = {
        decision: "block",
        reason: `Subagent brief exceeds the ${config.maxSubagentInputChars}-character context budget. Compact it to the task, target refs/files, required checks, and output schema; reference source files instead of copying large context blocks.`,
      };
    }
  } else if (event === "PostToolUse") {
    const classification = classifyHookTool(input);
    if (classification.kind === "state-change") {
      watchdog.recordStateProgress("tool_state_change_completed");
    } else if (classification.kind === "execution") {
      watchdog.recordExecutionProgress({ kind: "tool_execution_completed", toolName: input.tool_name });
    }

    const compacted = compactToolOutput(input.tool_response ?? "", {
      maxChars: config.maxToolOutputChars,
    });
    if (compacted.truncated) {
      output = {
        continue: false,
        stopReason: `tool_output_compacted: ${compacted.originalChars} chars -> ${compacted.text.length} chars; omitted ${compacted.omittedChars}. Omitted content is not positive evidence.\n${compacted.text}`,
      };
    }
  } else if (event === "Stop" || event === "SubagentStop") {
    output = stopDecision(watchdog, input);
  }

  return { output, state: stateOf(watchdog) };
}
