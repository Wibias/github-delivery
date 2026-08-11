import { createHash } from "node:crypto";

const DEFAULTS = Object.freeze({
  exactIntentRepeatThreshold: 3,
  recentIntentWindow: 8,
  lowNoveltyMinimum: 6,
  lowNoveltyUniqueMaximum: 3,
  volatileReadIntervalMs: 30_000,
});

const INTENT_PREFIX = /^\s*(?:(?:now|next|first|then|actually|meanwhile)[,:]?\s+)?(?:let me|i(?:'|’)ll|i will|i need to|i'm going to|i am going to)\s+/i;
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

export function createProgressWatchdog(options = {}) {
  const config = { ...DEFAULTS, ...options };
  let pendingNarration = "";
  let stateGeneration = Number.isInteger(options.stateGeneration)
    ? options.stateGeneration
    : 0;
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

  function processClause(clause) {
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
    pendingNarration += delta;

    const hasTerminator = /[\n.!?]/.test(pendingNarration);
    if (!hasTerminator) {
      if (pendingNarration.length > 4_000) pendingNarration = pendingNarration.slice(-4_000);
      return { action: "allow" };
    }

    let lastBoundary = -1;
    for (let index = 0; index < pendingNarration.length; index += 1) {
      if (/[\n.!?]/.test(pendingNarration[index])) lastBoundary = index;
    }
    if (lastBoundary < 0) return { action: "allow" };

    const complete = pendingNarration.slice(0, lastBoundary + 1);
    pendingNarration = pendingNarration.slice(lastBoundary + 1);
    for (const clause of clausesFromCompleteText(complete)) {
      const decision = processClause(clause);
      if (decision.action === "interrupt") return decision;
    }
    return { action: "allow" };
  }

  function recordExternalProgress() {
    resetNarration();
  }

  function recordStateChange() {
    stateGeneration += 1;
    reads.clear();
    resetNarration();
  }

  function decideRead({ toolName, input, volatility = "stable", now = Date.now() }) {
    if (!toolName) throw new Error("toolName is required");
    if (volatility !== "stable" && volatility !== "volatile") {
      throw new Error("volatility must be stable or volatile");
    }
    const fingerprint = fingerprintRead(stateGeneration, toolName, input);
    const prior = reads.get(fingerprint);
    if (!prior) {
      reads.set(fingerprint, { lastAllowedAt: now, volatility });
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
    reads.set(fingerprint, { lastAllowedAt: now, volatility });
    return { action: "allow", fingerprint, stateGeneration };
  }

  function snapshot() {
    return {
      schemaVersion: 1,
      stateGeneration,
      reads: Object.fromEntries(reads),
    };
  }

  return {
    observeAssistantDelta,
    recordExternalProgress,
    recordStateChange,
    decideRead,
    snapshot,
  };
}
