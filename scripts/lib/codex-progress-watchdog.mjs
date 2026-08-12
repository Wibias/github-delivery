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

export function observeCodexAppServerMessage(watchdog, message, context = {}) {
  if (!watchdog || typeof watchdog.observeAssistantDelta !== "function") {
    throw new Error("watchdog is required");
  }
  if (!context.interruptedTurns) context.interruptedTurns = new Set();
  if (!message || typeof message !== "object") return { decision: { action: "allow" } };

  const { method, params = {} } = message;
  if (isCodexGeneratedTextMethod(method)) {
    const decision = watchdog.observeAssistantDelta(params.delta || "");
    return maybeInterrupt(decision, params, context);
  }

  if (method === "thread/tokenUsage/updated") {
    const decision = watchdog.observeTokenUsage(generatedOutputTokens(params));
    return maybeInterrupt(decision, params, context);
  }

  if (method === "turn/diff/updated") {
    watchdog.observeDiffProgress(params.diff || "");
    return { decision: { action: "allow" } };
  }

  if (method === "turn/plan/updated") {
    watchdog.observePlanProgress(params.plan || []);
    return { decision: { action: "allow" } };
  }

  if (method === "item/started") {
    const item = params.item;
    if (RUNTIME_WORK_ITEM_TYPES.has(String(item?.type || ""))) {
      watchdog.recordToolStart({ type: item.type, id: item.id || null });
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
      } else if (classification.kind === "execution") {
        watchdog.recordExecutionProgress({ kind: "codex_execution_completed" });
      }
    }
    return { decision: { action: "allow" } };
  }

  if (method === "turn/completed" && params.turn?.id) {
    context.interruptedTurns.delete(params.turn.id);
  }

  return { decision: { action: "allow" } };
}
