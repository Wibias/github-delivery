import { createHash } from "node:crypto";

export const REVIEW_CONTEXT_PHASES = Object.freeze({
  BLIND_DISCOVERY: "blind-discovery",
  CONTEXT_RECONCILIATION: "context-reconciliation",
});

// Blind discovery is intentionally allowlist-based. Unknown context is withheld
// rather than accidentally exposing framing metadata to the first-pass reviewer.
export const BLIND_DISCOVERY_EVIDENCE_KEYS = Object.freeze([
  "repo",
  "pr",
  "baseRef",
  "baseSha",
  "headRef",
  "headSha",
  "diff",
  "changedFiles",
  "adjacentSource",
  "tests",
  "repositoryPolicies",
  "staticEvidence",
  "scopePlan",
  "requiredProbes",
]);

export const RECONCILIATION_CONTEXT_KEYS = Object.freeze([
  "prTitle",
  "prBody",
  "author",
  "labels",
  "issue",
  "spec",
  "commitMessages",
  "reviewComments",
  "reviewerVerdicts",
  "botConclusions",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function assertContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("review context must be an object");
  }
  if (!input.headSha || typeof input.headSha !== "string") {
    throw new TypeError("review context requires headSha");
  }
}

export function buildReviewContext(input, { phase = REVIEW_CONTEXT_PHASES.BLIND_DISCOVERY } = {}) {
  assertContext(input);
  if (!Object.values(REVIEW_CONTEXT_PHASES).includes(phase)) {
    throw new TypeError(`unknown review context phase: ${phase}`);
  }

  if (phase === REVIEW_CONTEXT_PHASES.CONTEXT_RECONCILIATION) {
    const context = structuredClone(input);
    return {
      schemaVersion: 1,
      kind: "github-delivery/review-context",
      phase,
      headSha: input.headSha,
      context,
      withheldKeys: [],
      fingerprint: fingerprint({ phase, headSha: input.headSha, context }),
    };
  }

  const context = {};
  for (const key of BLIND_DISCOVERY_EVIDENCE_KEYS) {
    if (Object.hasOwn(input, key)) context[key] = structuredClone(input[key]);
  }
  const withheldKeys = Object.keys(input)
    .filter((key) => !BLIND_DISCOVERY_EVIDENCE_KEYS.includes(key))
    .sort();

  return {
    schemaVersion: 1,
    kind: "github-delivery/review-context",
    phase,
    headSha: input.headSha,
    context,
    withheldKeys,
    fingerprint: fingerprint({ phase, headSha: input.headSha, context, withheldKeys }),
  };
}

export function assertContextHead(record, expectedHeadSha) {
  if (!record || record.kind !== "github-delivery/review-context") {
    throw new TypeError("invalid review context record");
  }
  if (record.headSha !== expectedHeadSha) {
    throw new Error(`stale review context: expected ${expectedHeadSha}, got ${record.headSha}`);
  }
  return true;
}
