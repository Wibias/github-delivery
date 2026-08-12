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

export function isCodexGeneratedTextMethod(method) {
  return GENERATED_TEXT_METHODS.has(String(method || ""));
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

  if (method === "item/started") {
    const classification = classifyAppServerItem(params.item);
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
      if (classification.kind === "state-change") {
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
