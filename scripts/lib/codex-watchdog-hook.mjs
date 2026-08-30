import { createProgressWatchdog } from "./watchdog-investigation-progress.mjs";
import {
  createEvidenceRegistry,
  deriveShellEvidenceDescriptor,
} from "./watchdog-evidence-registry.mjs";
import { classifyHookTool } from "./watchdog-progress-classifier.mjs";

const DEFAULT_MAX_NARRATION_RECOVERY_ATTEMPTS = 3;
const DEFAULT_STOP_FINALIZATION_CHAR_SOFT_LIMIT = 40_000;
const DEFAULT_STOP_FINALIZATION_CHAR_HARD_LIMIT = 64_000;
const TERMINAL_STOP_DISPOSITION_PATTERNS = [
  /\bno (?:further|additional) (?:tool\/action |tool |repository )?actions? (?:is|are|was|were) (?:authori[sz]ed|required|needed|available|possible)\b/i,
  /\bnothing (?:else|more) (?:is|was) (?:authori[sz]ed|required|needed)\b/i,
  /\b(?:cannot|can't|can not) (?:run|execute|perform|take|continue|proceed with) (?:the |that |this )?(?:selected next |selected |next )?(?:tool|action|step)\b/i,
  /\bblocked\b[^.\n]{0,240}\b(?:unauthori[sz]ed|prohibited|forbidden|not (?:permitted|allowed))\b/i,
];
const STRUCTURED_STOP_RECOMMENDATION_HEADING = /(?:^|\n)\s*#{1,6}\s+(?:[A-Z]\.\s*)?Recommendation\s*$/im;
const STRUCTURED_STOP_RECOMMENDATION_VALUE = /(?:^|\n)\s*`?NEXT_ACTION\s*=\s*[A-Z][A-Z0-9_]*`?\s*$/i;

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
  const watchdogOptions = {
    ...snapshot,
    volatileReadIntervalMs: options.volatileReadIntervalMs,
    evidenceSoftLimit: options.evidenceSoftLimit,
    evidenceHardLimit: options.evidenceHardLimit,
    investigationCreditLimit: options.investigationCreditLimit,
  };
  if (options.generatedCharSoftLimit !== undefined) {
    watchdogOptions.generatedCharSoftLimit = options.generatedCharSoftLimit;
  }
  if (options.generatedCharHardLimit !== undefined) {
    watchdogOptions.generatedCharHardLimit = options.generatedCharHardLimit;
  }
  return createProgressWatchdog(watchdogOptions);
}

function hydrateEvidence(state) {
  return createEvidenceRegistry(state?.evidenceRegistry || null);
}

function hydrateNarrationRecoveryAttempts(state) {
  const value = state?.narrationRecoveryAttempts;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function stateOf(watchdog, evidenceRegistry, narrationRecoveryAttempts) {
  return {
    watchdog: watchdog.snapshot(),
    evidenceRegistry: evidenceRegistry.snapshot(),
    narrationRecoveryAttempts,
  };
}

function duplicateReason(decision) {
  if (decision.reason === "poll_too_soon") {
    return `Repeated volatile poll blocked for ${decision.retryAfterMs}ms. Reuse the current snapshot; when pending CI is the only blocker use scripts/ci-wait.mjs instead of manual polling.`;
  }
  return "Duplicate read blocked on unchanged state. Reuse the valid evidence already captured; read again only after relevant state changes or the prior result becomes failed, ambiguous, or stale.";
}

function coveredEvidenceReason(descriptor) {
  return `Authoritative evidence for ${descriptor.key} already covers this request in the current state. Reuse the captured evidence instead of re-reading the same resource with another filter or command shape.`;
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

function shellEvidenceDescriptor(input) {
  const name = String(input?.tool_name || input?.toolName || "");
  if (name !== "Bash" && !/(?:^|__)shell(?:_|$)/i.test(name)) return null;
  const toolInput = input?.tool_input ?? input?.toolInput ?? {};
  return deriveShellEvidenceDescriptor(toolInput?.command);
}

function responseExplicitlyFailed(response) {
  if (!response || typeof response !== "object") return false;
  if (response.error) return true;
  if (response.success === false || response.ok === false) return true;
  const status = String(response.status || response.conclusion || "").toLowerCase();
  return ["failed", "failure", "error", "cancelled", "canceled", "rejected"].includes(status);
}

function recoveryReason(attempt, maxAttempts) {
  return `GitHub Delivery recovery ${attempt}/${maxAttempts}: no tool/action boundary followed the selected next step. Do not narrate or restate the plan. The next assistant action must invoke the already-selected tool/action if authorised; if it cannot run, report the concrete blocker once.`;
}

function hasTerminalStopDisposition(message) {
  return TERMINAL_STOP_DISPOSITION_PATTERNS.some((pattern) => pattern.test(message));
}

function hasStructuredStopRecommendation(message) {
  return (
    STRUCTURED_STOP_RECOMMENDATION_HEADING.test(message)
    && STRUCTURED_STOP_RECOMMENDATION_VALUE.test(message)
  );
}

function hasStopFinalizationDisposition(message) {
  return hasTerminalStopDisposition(message) || hasStructuredStopRecommendation(message);
}

function stopDecision(watchdog, input, recoveryAttempts, maxRecoveryAttempts) {
  const message = input.last_assistant_message || "";
  const priorToolIntentCount = watchdog.snapshot().toolEmissionIntentCount;
  const decision = watchdog.observeAssistantDelta(message);
  if (decision.reason === "tool_protocol_emission_stall") {
    return {
      output: {
        continue: false,
        stopReason: decision.reason,
        systemMessage: "GitHub Delivery stopped a repeated tool-protocol artifact stall.",
      },
      recoveryAttempts,
    };
  }

  const announcedToolAction = watchdog.snapshot().toolEmissionIntentCount > priorToolIntentCount;
  const finalizationDisposition = hasStopFinalizationDisposition(message);
  if (
    finalizationDisposition
    && decision.action !== "interrupt"
    && !announcedToolAction
  ) {
    return { output: null, recoveryAttempts: 0 };
  }

  const recoveryActive = recoveryAttempts > 0;
  const contradictoryFinalizationAction = finalizationDisposition && announcedToolAction;
  if (
    decision.action !== "interrupt"
    && !recoveryActive
    && !contradictoryFinalizationAction
  ) {
    return { output: null, recoveryAttempts: 0 };
  }

  const nextAttempt = recoveryAttempts + 1;
  if (nextAttempt > maxRecoveryAttempts) {
    return {
      output: {
        continue: false,
        stopReason: "no_progress_stall_after_bounded_recovery",
        systemMessage: `GitHub Delivery stopped a no-progress narration stall after ${maxRecoveryAttempts} corrective continuations without a real tool/action boundary.`,
      },
      recoveryAttempts: nextAttempt,
    };
  }

  return {
    output: {
      decision: "block",
      reason: recoveryReason(nextAttempt, maxRecoveryAttempts),
    },
    recoveryAttempts: nextAttempt,
  };
}

export function evaluateCodexHook(input, state = {}, options = {}) {
  const event = input?.hook_event_name;
  const message = typeof input?.last_assistant_message === "string"
    ? input.last_assistant_message
    : "";
  const stopFinalizationCharSoftLimit =
    options.stopFinalizationCharSoftLimit ?? DEFAULT_STOP_FINALIZATION_CHAR_SOFT_LIMIT;
  const stopFinalizationCharHardLimit =
    options.stopFinalizationCharHardLimit ?? DEFAULT_STOP_FINALIZATION_CHAR_HARD_LIMIT;
  const stopFinalizationCandidate = (
    event === "Stop"
    && message.length <= stopFinalizationCharHardLimit
    && hasStopFinalizationDisposition(message)
  );
  const config = {
    now: options.now ?? Date.now(),
    volatileReadIntervalMs: options.volatileReadIntervalMs ?? 30_000,
    maxSubagentInputChars: options.maxSubagentInputChars ?? 6_000,
    evidenceSoftLimit: options.evidenceSoftLimit ?? 8,
    evidenceHardLimit: options.evidenceHardLimit ?? 12,
    investigationCreditLimit: options.investigationCreditLimit,
    maxNarrationRecoveryAttempts:
      options.maxNarrationRecoveryAttempts ?? DEFAULT_MAX_NARRATION_RECOVERY_ATTEMPTS,
    generatedCharSoftLimit: stopFinalizationCandidate
      ? stopFinalizationCharSoftLimit
      : undefined,
    generatedCharHardLimit: stopFinalizationCandidate
      ? stopFinalizationCharHardLimit
      : undefined,
  };
  if (
    !Number.isInteger(config.maxNarrationRecoveryAttempts)
    || config.maxNarrationRecoveryAttempts < 1
  ) {
    throw new Error("maxNarrationRecoveryAttempts must be a positive integer");
  }

  const watchdog = hydrate(state, config);
  const evidenceRegistry = hydrateEvidence(state);
  let narrationRecoveryAttempts = hydrateNarrationRecoveryAttempts(state);
  let output = null;

  if (event === "PreToolUse") {
    // Reaching the real tool boundary resolves a narration-only recovery even if
    // economy policy later blocks the selected tool as duplicate or too broad.
    watchdog.recordToolStart();
    narrationRecoveryAttempts = 0;

    const classification = classifyHookTool(input);
    if (classification.kind === "evidence") {
      const descriptor = shellEvidenceDescriptor(input);
      const generation = watchdog.snapshot().stateGeneration;
      const coverageDecision = descriptor
        ? evidenceRegistry.decide({
            stateGeneration: generation,
            key: descriptor.key,
            requires: descriptor.covers,
          })
        : { action: "allow" };

      if (coverageDecision.action === "block") {
        output = { decision: "block", reason: coveredEvidenceReason(descriptor) };
      } else {
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
    } else if (classification.kind === "evidence" && !responseExplicitlyFailed(input.tool_response)) {
      watchdog.recordEvidenceResult({
        toolName: input.tool_name,
        input: input.tool_input,
        volatility: classification.volatility || "stable",
        response: input.tool_response,
      });
      const descriptor = shellEvidenceDescriptor(input);
      if (descriptor) {
        evidenceRegistry.record({
          stateGeneration: watchdog.snapshot().stateGeneration,
          key: descriptor.key,
          covers: descriptor.covers,
          authoritative: descriptor.authoritative,
        });
      }
    }
    // PostToolUse must never replace or truncate a successful tool result. Doing
    // so destroys evidence after the tool ran and can cause the model to re-read
    // the same source with another command. Compact at the source/helper instead.
  } else if (event === "Stop" || event === "SubagentStop") {
    const stop = stopDecision(
      watchdog,
      input,
      narrationRecoveryAttempts,
      config.maxNarrationRecoveryAttempts,
    );
    output = stop.output;
    narrationRecoveryAttempts = stop.recoveryAttempts;
  }

  return {
    output,
    state: stateOf(watchdog, evidenceRegistry, narrationRecoveryAttempts),
  };
}
