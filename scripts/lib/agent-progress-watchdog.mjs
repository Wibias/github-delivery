import { createHash } from "node:crypto";

const DEFAULTS = Object.freeze({
  exactIntentRepeatThreshold: 3,
  recentIntentWindow: 8,
  lowNoveltyMinimum: 6,
  lowNoveltyUniqueMaximum: 3,
  volatileReadIntervalMs: 30_000,
  evidenceSoftLimit: 8,
  evidenceHardLimit: 12,
  generatedCharSoftLimit: 6_000,
  generatedCharHardLimit: 12_000,
  noProgressTokenSoftLimit: 4_000,
  noProgressTokenHardLimit: 8_000,
  toolEmissionIntentThreshold: 6,
  protocolArtifactThreshold: 3,
});

const INTENT_PREFIX = /^\s*(?:(?:now|next|first|then|actually|meanwhile)[,:]?\s+)?(?:let me|i(?:'|’)ll|i will|i need to|i'm going to|i am going to)\s+/i;
const TOOL_EMISSION_INTENT = /^\s*(?:(?:now|next|then|actually|enough|finally|stop narrating)[,:.!]?\s+)?(?:(?:let me|i(?:'|’)ll|i will|i need to|i(?:'|’)m going to|i am going to)\s+)?(?:(?:just|actually)\s+)?(?:run|running|execute|executing|invoke|invoking|call|calling|issue|issuing|emit|emitting|grep|search|read|open|inspect|apply|patch|use)\b/i;
const TOOL_PROTOCOL_ARTIFACT = /<\/?(?:atool|invoke|tool_calls?|function_calls?)\b[^>]*>/gi;
const FAILURE_SIGNAL = /\b(error|errors|fail|failed|failure|failing|blocked|blocker|exception|traceback|denied|timeout|timed out|exit(?: code)?|conclusion|status|unsponsored_surface)\b/i;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprintRead(stateGeneration, toolName, input) {
  return createHash("sha256")
    .update(`${stateGeneration}\0${toolName}\0${stableStringify(input ?? null)}`)
    .digest("hex");
}

function fingerprintText(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeIntent(clause) {
  if (!INTENT_PREFIX.test(clause)) return null;
  return clause
    .replace(INTENT_PREFIX, "")
    .toLowerCase()
    .replace(/[`'"“”‘’()[\]{}]/g, "")
    .replace(/\b(the|a|an|this|that|specific|relevant|current)\b/g, " ")
    .replace(/\b(check|inspect|look at|open|read through)\b/g, "read")
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clausesFromCompleteText(text) {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function asText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function uniqueFailureLines(text, limit) {
  const seen = new Set();
  const output = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !FAILURE_SIGNAL.test(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    output.push(trimmed);
    if (output.length >= limit) break;
  }
  return output;
}

export function compactToolOutput(value, { maxChars = 4_000 } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 240) {
    throw new Error("maxChars must be an integer >= 240");
  }
  const original = asText(value);
  if (original.length <= maxChars) {
    return {
      text: original,
      truncated: false,
      originalChars: original.length,
      omittedChars: 0,
    };
  }

  const important = uniqueFailureLines(original, 12).join("\n");
  const importantBudget = Math.min(Math.floor(maxChars * 0.28), important.length);
  const importantText = important.slice(0, importantBudget);
  const separator = importantText ? `\n[signals]\n${importantText}\n[/signals]\n` : "";
  const markerReserve = 128;
  const payloadBudget = Math.max(0, maxChars - markerReserve - separator.length);
  const headBudget = Math.floor(payloadBudget * 0.52);
  const tailBudget = payloadBudget - headBudget;
  const head = original.slice(0, headBudget);
  const tail = original.slice(original.length - tailBudget);
  const omittedChars = Math.max(0, original.length - head.length - tail.length);
  const marker = `\n[github-delivery watchdog: tool output compacted; original ${original.length} chars; omitted ${omittedChars}]\n`;

  let text = `${head}${marker}${separator}${tail}`;
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return {
    text,
    truncated: true,
    originalChars: original.length,
    omittedChars,
  };
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function validateBudget(config, softName, hardName) {
  if (!Number.isInteger(config[softName]) || config[softName] < 1) {
    throw new Error(`${softName} must be a positive integer`);
  }
  if (!Number.isInteger(config[hardName]) || config[hardName] < config[softName]) {
    throw new Error(`${hardName} must be an integer >= ${softName}`);
  }
}

export function createProgressWatchdog(options = {}) {
  const config = { ...DEFAULTS, ...options };
  validateBudget(config, "evidenceSoftLimit", "evidenceHardLimit");
  validateBudget(config, "generatedCharSoftLimit", "generatedCharHardLimit");
  validateBudget(config, "noProgressTokenSoftLimit", "noProgressTokenHardLimit");
  if (!Number.isInteger(config.toolEmissionIntentThreshold) || config.toolEmissionIntentThreshold < 2) {
    throw new Error("toolEmissionIntentThreshold must be an integer >= 2");
  }
  if (!Number.isInteger(config.protocolArtifactThreshold) || config.protocolArtifactThreshold < 1) {
    throw new Error("protocolArtifactThreshold must be a positive integer");
  }

  let pendingNarration = "";
  let stateGeneration = nonNegativeInteger(options.stateGeneration);
  let consecutiveEvidenceAttempts = nonNegativeInteger(options.consecutiveEvidenceAttempts);
  let totalEvidenceAttempts = nonNegativeInteger(options.totalEvidenceAttempts);
  let evidenceWarningIssued = Boolean(options.evidenceWarningIssued);
  let executionProgressCount = nonNegativeInteger(options.executionProgressCount);
  let stateProgressCount = nonNegativeInteger(options.stateProgressCount);
  let workflowProgressCount = nonNegativeInteger(options.workflowProgressCount);
  let generatedCharsSinceProgress = nonNegativeInteger(options.generatedCharsSinceProgress);
  let toolEmissionIntentCount = nonNegativeInteger(options.toolEmissionIntentCount);
  let protocolArtifactCount = nonNegativeInteger(options.protocolArtifactCount);
  let latestGeneratedTokens = Number.isInteger(options.latestGeneratedTokens)
    ? options.latestGeneratedTokens
    : null;
  let generatedTokenBaseline = Number.isInteger(options.generatedTokenBaseline)
    ? options.generatedTokenBaseline
    : latestGeneratedTokens;
  let lastDiffFingerprint = typeof options.lastDiffFingerprint === "string"
    ? options.lastDiffFingerprint
    : null;
  let maxCompletedPlanSteps = nonNegativeInteger(options.maxCompletedPlanSteps);
  const intentCounts = new Map();
  const recentIntents = [];
  const reads = new Map();

  if (options.reads && typeof options.reads === "object") {
    for (const [key, value] of Object.entries(options.reads)) reads.set(key, value);
  }

  function resetNarration() {
    pendingNarration = "";
    intentCounts.clear();
    recentIntents.length = 0;
  }

  function resetToolEmissionSignals() {
    toolEmissionIntentCount = 0;
    protocolArtifactCount = 0;
    pendingNarration = "";
  }

  function resetToolEmissionStall() {
    resetToolEmissionSignals();
    resetNarration();
  }

  function resetNoProgressBudgets() {
    generatedCharsSinceProgress = 0;
    generatedTokenBaseline = latestGeneratedTokens;
    resetToolEmissionStall();
  }

  function resetEvidenceStreak() {
    consecutiveEvidenceAttempts = 0;
    evidenceWarningIssued = false;
  }

  function generatedBudgetDecision() {
    if (generatedCharsSinceProgress >= config.generatedCharHardLimit) {
      return {
        action: "interrupt",
        reason: "no_progress_generation_budget_exhausted",
        details: {
          generatedCharsSinceProgress,
          hardLimit: config.generatedCharHardLimit,
        },
      };
    }
    if (generatedCharsSinceProgress >= config.generatedCharSoftLimit) {
      return {
        action: "warn",
        reason: "no_progress_generation_budget_warning",
        details: {
          generatedCharsSinceProgress,
          softLimit: config.generatedCharSoftLimit,
          hardLimit: config.generatedCharHardLimit,
        },
      };
    }
    return { action: "allow" };
  }

  function processClause(clause) {
    if (clause.length <= 200 && TOOL_EMISSION_INTENT.test(clause)) {
      toolEmissionIntentCount += 1;
      if (toolEmissionIntentCount >= config.toolEmissionIntentThreshold) {
        return {
          action: "interrupt",
          reason: "tool_emission_stall",
          details: { toolEmissionIntentCount },
        };
      }
    }

    const intent = normalizeIntent(clause);
    if (!intent) return { action: "allow" };
    const count = (intentCounts.get(intent) || 0) + 1;
    intentCounts.set(intent, count);
    recentIntents.push(intent);
    if (recentIntents.length > config.recentIntentWindow) recentIntents.shift();

    if (count >= config.exactIntentRepeatThreshold) {
      return {
        action: "interrupt",
        reason: "no_progress_stall",
        details: { repeatedIntent: intent, repeatCount: count },
      };
    }

    if (recentIntents.length >= config.lowNoveltyMinimum) {
      const unique = new Set(recentIntents);
      if (unique.size <= config.lowNoveltyUniqueMaximum) {
        return {
          action: "interrupt",
          reason: "no_progress_stall",
          details: {
            intentClauses: recentIntents.length,
            uniqueIntents: unique.size,
          },
        };
      }
    }
    return { action: "allow" };
  }

  function observeAssistantDelta(delta) {
    if (typeof delta !== "string" || delta.length === 0) return { action: "allow" };
    generatedCharsSinceProgress += delta.length;

    const protocolArtifacts = delta.match(TOOL_PROTOCOL_ARTIFACT);
    if (protocolArtifacts?.length) {
      protocolArtifactCount += protocolArtifacts.length;
      if (protocolArtifactCount >= config.protocolArtifactThreshold) {
        return {
          action: "interrupt",
          reason: "tool_protocol_emission_stall",
          details: { protocolArtifactCount },
        };
      }
    }

    const charBudget = generatedBudgetDecision();
    if (charBudget.action === "interrupt") return charBudget;

    pendingNarration += delta;
    const hasTerminator = /[\n.!?]/.test(pendingNarration);
    if (!hasTerminator) {
      if (pendingNarration.length > 4_000) pendingNarration = pendingNarration.slice(-4_000);
      return charBudget;
    }

    let lastBoundary = -1;
    for (let index = 0; index < pendingNarration.length; index += 1) {
      if (/[\n.!?]/.test(pendingNarration[index])) lastBoundary = index;
    }
    if (lastBoundary < 0) return charBudget;

    const complete = pendingNarration.slice(0, lastBoundary + 1);
    pendingNarration = pendingNarration.slice(lastBoundary + 1);
    for (const clause of clausesFromCompleteText(complete)) {
      const decision = processClause(clause);
      if (decision.action === "interrupt") return decision;
    }
    return charBudget;
  }

  function observeTokenUsage(generatedTokens) {
    if (!Number.isInteger(generatedTokens) || generatedTokens < 0) {
      return { action: "allow" };
    }
    if (latestGeneratedTokens === null || generatedTokens < latestGeneratedTokens) {
      latestGeneratedTokens = generatedTokens;
      generatedTokenBaseline = generatedTokens;
      return { action: "allow", generatedTokensSinceProgress: 0 };
    }
    latestGeneratedTokens = generatedTokens;
    if (generatedTokenBaseline === null) generatedTokenBaseline = generatedTokens;
    const generatedTokensSinceProgress = Math.max(0, generatedTokens - generatedTokenBaseline);
    if (generatedTokensSinceProgress >= config.noProgressTokenHardLimit) {
      return {
        action: "interrupt",
        reason: "no_progress_token_budget_exhausted",
        details: {
          generatedTokensSinceProgress,
          hardLimit: config.noProgressTokenHardLimit,
        },
      };
    }
    if (generatedTokensSinceProgress >= config.noProgressTokenSoftLimit) {
      return {
        action: "warn",
        reason: "no_progress_token_budget_warning",
        details: {
          generatedTokensSinceProgress,
          softLimit: config.noProgressTokenSoftLimit,
          hardLimit: config.noProgressTokenHardLimit,
        },
      };
    }
    return { action: "allow", generatedTokensSinceProgress };
  }

  function observeDiffProgress(diff) {
    const value = String(diff || "");
    const fingerprint = fingerprintText(value);
    if (lastDiffFingerprint === null) {
      lastDiffFingerprint = fingerprint;
      if (!value.trim()) return { progressed: false };
      recordStateProgress();
      return { progressed: true };
    }
    if (fingerprint === lastDiffFingerprint) return { progressed: false };
    lastDiffFingerprint = fingerprint;
    recordStateProgress();
    return { progressed: true };
  }

  function observePlanProgress(plan) {
    if (!Array.isArray(plan)) return { progressed: false };
    const completed = plan.filter((entry) => String(entry?.status || "") === "completed").length;
    if (completed <= maxCompletedPlanSteps) return { progressed: false };
    maxCompletedPlanSteps = completed;
    recordWorkflowProgress();
    return { progressed: true, completedPlanSteps: completed };
  }

  function chargeEvidenceAttempt() {
    totalEvidenceAttempts += 1;
    consecutiveEvidenceAttempts += 1;

    if (consecutiveEvidenceAttempts >= config.evidenceHardLimit) {
      return {
        action: "block",
        reason: "evidence_budget_exhausted",
        consecutiveEvidenceAttempts,
        totalEvidenceAttempts,
        softLimit: config.evidenceSoftLimit,
        hardLimit: config.evidenceHardLimit,
      };
    }

    if (
      consecutiveEvidenceAttempts >= config.evidenceSoftLimit &&
      !evidenceWarningIssued
    ) {
      evidenceWarningIssued = true;
      return {
        action: "warn",
        reason: "evidence_budget_warning",
        consecutiveEvidenceAttempts,
        totalEvidenceAttempts,
        softLimit: config.evidenceSoftLimit,
        hardLimit: config.evidenceHardLimit,
      };
    }

    return {
      action: "allow",
      consecutiveEvidenceAttempts,
      totalEvidenceAttempts,
    };
  }

  function recordToolStart() {
    resetToolEmissionSignals();
  }

  function recordExecutionProgress() {
    executionProgressCount += 1;
    resetEvidenceStreak();
    resetNoProgressBudgets();
  }

  function recordWorkflowProgress() {
    workflowProgressCount += 1;
    resetEvidenceStreak();
    resetNoProgressBudgets();
  }

  function recordStateProgress() {
    stateGeneration += 1;
    stateProgressCount += 1;
    reads.clear();
    resetEvidenceStreak();
    resetNoProgressBudgets();
  }

  function recordExternalProgress() {
    recordExecutionProgress();
  }

  function recordStateChange() {
    recordStateProgress();
  }

  function decideRead({
    toolName,
    input,
    volatility = "stable",
    now = Date.now(),
    record = true,
  }) {
    if (!toolName) throw new Error("toolName is required");
    if (volatility !== "stable" && volatility !== "volatile") {
      throw new Error("volatility must be stable or volatile");
    }
    const fingerprint = fingerprintRead(stateGeneration, toolName, input);
    const prior = reads.get(fingerprint);
    if (!prior) {
      if (record) reads.set(fingerprint, { lastAllowedAt: now, volatility });
      return { action: "allow", fingerprint, stateGeneration };
    }

    if (volatility === "stable") {
      return {
        action: "block",
        reason: "duplicate_read_unchanged_state",
        fingerprint,
        stateGeneration,
      };
    }

    const elapsedMs = now - prior.lastAllowedAt;
    if (elapsedMs < config.volatileReadIntervalMs) {
      return {
        action: "block",
        reason: "poll_too_soon",
        retryAfterMs: config.volatileReadIntervalMs - elapsedMs,
        fingerprint,
        stateGeneration,
      };
    }
    if (record) reads.set(fingerprint, { lastAllowedAt: now, volatility });
    return { action: "allow", fingerprint, stateGeneration };
  }

  function snapshot() {
    return {
      schemaVersion: 2,
      stateGeneration,
      reads: Object.fromEntries(reads),
      consecutiveEvidenceAttempts,
      totalEvidenceAttempts,
      evidenceWarningIssued,
      executionProgressCount,
      stateProgressCount,
      workflowProgressCount,
      generatedCharsSinceProgress,
      toolEmissionIntentCount,
      protocolArtifactCount,
      latestGeneratedTokens,
      generatedTokenBaseline,
      lastDiffFingerprint,
      maxCompletedPlanSteps,
    };
  }

  return {
    observeAssistantDelta,
    observeTokenUsage,
    observeDiffProgress,
    observePlanProgress,
    chargeEvidenceAttempt,
    recordToolStart,
    recordExecutionProgress,
    recordWorkflowProgress,
    recordStateProgress,
    recordExternalProgress,
    recordStateChange,
    decideRead,
    snapshot,
  };
}
