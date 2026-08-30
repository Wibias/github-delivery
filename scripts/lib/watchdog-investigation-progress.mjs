import { posix } from "node:path";

import { createProgressWatchdog as createBaseProgressWatchdog } from "./agent-progress-watchdog.mjs";

const DEFAULT_INVESTIGATION_CREDIT_LIMIT = 4;
const SOURCE_READ_COMMAND = /\b(?:get-content|cat|type)\b\s+(?:(?:-path|-literalpath)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/i;
const SOURCE_PATH = /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|md|ps1|cs|csproj|fs|go|rs|py|rb|php|java|kt|kts|swift|c|cc|cpp|cxx|h|hh|hpp|sh|bash|zsh)$/i;

function asText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? "");
  }
}

function normalizeSourcePath(value) {
  let path = String(value || "").trim().replace(/^['"]|['"]$/g, "").replace(/\\/g, "/");
  if (!path || /^https?:\/\//i.test(path)) return null;
  path = posix.normalize(path).replace(/^\.\//, "");
  return SOURCE_PATH.test(path) ? path : null;
}

function sourceReadTarget(toolName, input = {}) {
  const direct = input?.path ?? input?.file_path ?? input?.filePath ?? input?.filename;
  const directTarget = normalizeSourcePath(direct);
  if (directTarget) return directTarget;

  const name = String(toolName || "");
  if (name !== "Bash" && !/(?:^|__)shell(?:_|$)/i.test(name) && name !== "commandExecution") {
    return null;
  }
  const command = String(input?.command ?? input?.commandText ?? "");
  const match = command.match(SOURCE_READ_COMMAND);
  return normalizeSourcePath(match?.[1] || match?.[2] || match?.[3]);
}

function resolveReference(currentTarget, reference) {
  const raw = String(reference || "").trim().replace(/\\/g, "/");
  if (!raw || !SOURCE_PATH.test(raw)) return null;
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return normalizeSourcePath(posix.join(posix.dirname(currentTarget), raw));
  }
  return normalizeSourcePath(raw);
}

function referencedSourceTargets(response, currentTarget) {
  if (!currentTarget) return [];
  const text = asText(response);
  const found = new Set();
  const patterns = [
    /\b(?:from|require\s*\(|import\s*\()\s*["']([^"']+)["']/g,
    /["']((?:\.\.?\/|[A-Za-z0-9_.-]+\/)[^"']+\.[A-Za-z0-9]+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const target = resolveReference(currentTarget, match[1]);
      if (target) found.add(target);
    }
  }
  return [...found].sort();
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function createProgressWatchdog(options = {}) {
  const base = createBaseProgressWatchdog(options);
  const persistedCreditLimit = positiveInteger(
    options.investigationCreditLimitPersisted,
    DEFAULT_INVESTIGATION_CREDIT_LIMIT,
  );
  const creditLimit = positiveInteger(options.investigationCreditLimit, persistedCreditLimit);
  let creditGeneration = Number.isInteger(options.investigationCreditGeneration)
    ? options.investigationCreditGeneration
    : base.snapshot().stateGeneration;
  let creditsUsed = nonNegativeInteger(options.investigationCreditsUsed);
  let creditedSinceHydration = 0;
  let referencedTargets = new Set(
    Array.isArray(options.investigationReferencedTargets)
      ? options.investigationReferencedTargets.map(normalizeSourcePath).filter(Boolean)
      : [],
  );
  let pendingCreditFingerprint = null;

  function syncGeneration() {
    const generation = base.snapshot().stateGeneration;
    if (generation !== creditGeneration) {
      creditGeneration = generation;
      creditsUsed = 0;
      referencedTargets = new Set();
      pendingCreditFingerprint = null;
    }
    return generation;
  }

  function decideRead(options = {}) {
    const decision = base.decideRead(options);
    syncGeneration();
    if (options.record === false) {
      pendingCreditFingerprint = null;
      if (decision.action === "allow" && options.volatility !== "volatile") {
        const target = sourceReadTarget(options.toolName, options.input);
        if (target && referencedTargets.has(target) && creditsUsed < creditLimit) {
          pendingCreditFingerprint = decision.fingerprint;
        }
      }
    }
    return decision;
  }

  function prepareEvidenceAttempt({ toolName, input, volatility = "stable" } = {}) {
    syncGeneration();
    pendingCreditFingerprint = null;
    if (volatility === "volatile" || creditsUsed >= creditLimit) return false;
    const target = sourceReadTarget(toolName, input);
    if (!target || !referencedTargets.has(target)) return false;
    pendingCreditFingerprint = `prepared:${target}`;
    return true;
  }

  function chargeEvidenceAttempt() {
    syncGeneration();
    if (pendingCreditFingerprint && creditsUsed < creditLimit) {
      creditsUsed += 1;
      creditedSinceHydration += 1;
      pendingCreditFingerprint = null;
      const current = base.snapshot();
      return {
        action: "allow",
        reason: "dependency_following_investigation_progress",
        investigationProgress: true,
        investigationCreditsUsed: creditsUsed,
        investigationCreditLimit: creditLimit,
        consecutiveEvidenceAttempts: current.consecutiveEvidenceAttempts,
        totalEvidenceAttempts: current.totalEvidenceAttempts + creditedSinceHydration,
      };
    }
    const decision = base.chargeEvidenceAttempt();
    return {
      ...decision,
      totalEvidenceAttempts: decision.totalEvidenceAttempts + creditedSinceHydration,
      investigationCreditsUsed: creditsUsed,
      investigationCreditLimit: creditLimit,
    };
  }

  function recordEvidenceResult({ toolName, input, volatility = "stable", response } = {}) {
    syncGeneration();
    if (volatility === "volatile") {
      referencedTargets = new Set();
      return [];
    }
    const target = sourceReadTarget(toolName, input);
    referencedTargets = new Set(referencedSourceTargets(response, target));
    return [...referencedTargets];
  }

  function snapshot() {
    syncGeneration();
    const current = base.snapshot();
    return {
      ...current,
      totalEvidenceAttempts: current.totalEvidenceAttempts + creditedSinceHydration,
      investigationCreditGeneration: creditGeneration,
      investigationCreditsUsed: creditsUsed,
      investigationCreditLimit: creditLimit,
      investigationCreditLimitPersisted: creditLimit,
      investigationReferencedTargets: [...referencedTargets].sort(),
    };
  }

  return {
    ...base,
    decideRead,
    prepareEvidenceAttempt,
    chargeEvidenceAttempt,
    recordEvidenceResult,
    snapshot,
  };
}
