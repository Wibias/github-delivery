import { createProgressWatchdog } from "./agent-progress-watchdog.mjs";
import {
  classifyAppServerItem,
  isSuccessfulAppServerItem,
} from "./watchdog-progress-classifier.mjs";

const GENERATED_TEXT_METHODS = new Set([
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
]);

const RUNTIME_WORK_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "webSearch",
  "imageView",
]);

const FINALIZATION_WATCHDOG_OPTIONS = Object.freeze({
  generatedCharSoftLimit: 40_000,
  generatedCharHardLimit: 64_000,
  noProgressTokenSoftLimit: 12_000,
  noProgressTokenHardLimit: 16_000,
});

const MICRO_NARRATION_INTENT_THRESHOLD = 3;
const MICRO_NARRATION_INTENT = /(?:^|\b(?:so|and|then|next)[,:]?\s+)(?:next\s+)?(?:let me|i(?:'|’)ll|i will|i need to|i(?:'|’)m going to|i am going to)\s+(?:(?:start(?:ing)?(?:\s+by)?|now|next|then|first|just)\s+)*(?:load|read|verify|check|inspect|fetch|recapture|lock|run|execute|invoke|call|search|open|use|apply|patch|edit|write|update|fix|change)\b/i;

export function isCodexGeneratedTextMethod(method) {
  return GENERATED_TEXT_METHODS.has(String(method || ""));
}

function generatedOutputTokens(params) {
  const total = params?.tokenUsage?.total;
  const outputTokens = Number(total?.outputTokens);
  if (Number.isInteger(outputTokens) && outputTokens >= 0) return outputTokens;

  // Compatibility fallback for older/synthetic payloads that expose only a
  // cumulative total. Current Codex v2 emits outputTokens separately and that
  // field is preferred so repeated input/context tokens cannot exhaust the
  // generation budget.
  const totalTokens = Number(total?.totalTokens);
  return Number.isInteger(totalTokens) && totalTokens >= 0 ? totalTokens : null;
}

function maybeInterrupt(decision, params, context) {
  const threadId = params.threadId;
  const turnId = params.turnId || params.turn?.id;
  if (
    decision?.action !== "interrupt" &&
    decision?.action !== "block"
  ) {
    return { decision: decision || { action: "allow" } };
  }
  if (!threadId || !turnId || context.interruptedTurns.has(turnId)) {
    return { decision };
  }
  context.interruptedTurns.add(turnId);
  return {
    decision,
    interrupt: {
      method: "turn/interrupt",
      params: { threadId, turnId },
    },
  };
}

function planIsComplete(plan) {
  return (
    Array.isArray(plan) &&
    plan.length > 0 &&
    plan.every((entry) => String(entry?.status || "").toLowerCase() === "completed")
  );
}

function finalizationWatchdog(context) {
  if (!context.finalizationWatchdog) {
    context.finalizationWatchdog = createProgressWatchdog(FINALIZATION_WATCHDOG_OPTIONS);
  }
  return context.finalizationWatchdog;
}

function activeTextWatchdog(watchdog, context) {
  return context.finalizing ? finalizationWatchdog(context) : watchdog;
}

function resetMicroNarration(context) {
  context.microNarrationBuffer = "";
  context.microNarrationIntentCount = 0;
}

function observeMicroNarration(delta, context) {
  if (typeof delta !== "string" || delta.length === 0) return { action: "allow" };
  const current = `${context.microNarrationBuffer || ""}${delta}`;
  let lastBoundary = -1;
  for (let index = 0; index < current.length; index += 1) {
    if (/[\n.!?]/.test(current[index])) lastBoundary = index;
  }
  if (lastBoundary < 0) {
    context.microNarrationBuffer = current.length > 2_000 ? current.slice(-2_000) : current;
    return { action: "allow" };
  }

  const complete = current.slice(0, lastBoundary + 1);
  context.microNarrationBuffer = current.slice(lastBoundary + 1);
  for (const clause of complete
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter(Boolean)) {
    if (clause.length > 320 || !MICRO_NARRATION_INTENT.test(clause)) continue;
    context.microNarrationIntentCount = Number(context.microNarrationIntentCount || 0) + 1;
    if (context.microNarrationIntentCount >= MICRO_NARRATION_INTENT_THRESHOLD) {
      return {
        action: "interrupt",
        reason: "micro_narration_budget_exhausted",
        details: {
          microNarrationIntentCount: context.microNarrationIntentCount,
          hardLimit: MICRO_NARRATION_INTENT_THRESHOLD,
        },
      };
    }
  }
  return { action: "allow" };
}

export function observeCodexAppServerMessage(watchdog, message, context = {}) {
  if (!watchdog || typeof watchdog.observeAssistantDelta !== "function") {
    throw new Error("watchdog is required");
  }
  if (!context.interruptedTurns) context.interruptedTurns = new Set();
  if (!message || typeof message !== "object") return { decision: { action: "allow" } };

  const { method, params = {} } = message;
  if (isCodexGeneratedTextMethod(method)) {
    if (!context.finalizing) {
      const narrationDecision = observeMicroNarration(params.delta || "", context);
      if (narrationDecision.action === "interrupt") {
        return maybeInterrupt(narrationDecision, params, context);
      }
    }
    const decision = activeTextWatchdog(watchdog, context).observeAssistantDelta(params.delta || "");
    return maybeInterrupt(decision, params, context);
  }

  if (method === "thread/tokenUsage/updated") {
    const decision = activeTextWatchdog(watchdog, context).observeTokenUsage(
      generatedOutputTokens(params),
    );
    return maybeInterrupt(decision, params, context);
  }

  if (method === "turn/diff/updated") {
    const progress = watchdog.observeDiffProgress(params.diff || "");
    if (progress?.progressed) resetMicroNarration(context);
    return { decision: { action: "allow" } };
  }

  if (method === "turn/plan/updated") {
    const progress = watchdog.observePlanProgress(params.plan || []);
    if (progress?.progressed) resetMicroNarration(context);
    const complete = planIsComplete(params.plan);
    if (complete && !context.finalizing) {
      context.finalizing = true;
      context.finalizationWatchdog = createProgressWatchdog(FINALIZATION_WATCHDOG_OPTIONS);
      resetMicroNarration(context);
    } else if (!complete && context.finalizing) {
      context.finalizing = false;
      context.finalizationWatchdog = null;
    }
    return { decision: { action: "allow" } };
  }

  if (method === "item/started") {
    const item = params.item;
    if (RUNTIME_WORK_ITEM_TYPES.has(String(item?.type || ""))) {
      watchdog.recordToolStart({ type: item.type, id: item.id || null });
      context.finalizing = false;
      context.finalizationWatchdog = null;
    }
    const classification = classifyAppServerItem(item);
    if (classification.kind === "evidence") {
      const decision = watchdog.chargeEvidenceAttempt();
      if (decision.action === "block") {
        return maybeInterrupt(
          { ...decision, action: "interrupt" },
          params,
          context,
        );
      }
      return { decision };
    }
    return { decision: { action: "allow" } };
  }

  if (method === "item/completed") {
    const item = params.item;
    const classification = classifyAppServerItem(item);
    if (isSuccessfulAppServerItem(item)) {
      if (classification.kind === "state-change" && item?.type !== "fileChange") {
        watchdog.recordStateProgress("codex_state_change_completed");
        resetMicroNarration(context);
      } else if (classification.kind === "execution") {
        watchdog.recordExecutionProgress({ kind: "codex_execution_completed" });
        resetMicroNarration(context);
      }
    }
    return { decision: { action: "allow" } };
  }

  if (method === "turn/completed" && params.turn?.id) {
    context.interruptedTurns.delete(params.turn.id);
    context.finalizing = false;
    context.finalizationWatchdog = null;
    resetMicroNarration(context);
  }

  return { decision: { action: "allow" } };
}