import { createHash } from "node:crypto";

export const CANDIDATE_STATES = Object.freeze([
  "candidate",
  "needs-more-evidence",
  "validated",
  "rejected",
  "manual-review",
]);

export const VALIDATION_VERDICTS = Object.freeze([
  "accept",
  "reject",
  "request-more-evidence",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function requireString(value, field) {
  if (!value || typeof value !== "string") throw new TypeError(`${field} must be a non-empty string`);
}

function requireLedger(ledger) {
  if (!ledger || ledger.kind !== "github-delivery/review-candidate-ledger") {
    throw new TypeError("invalid review candidate ledger");
  }
  if (!Array.isArray(ledger.candidates) || !Array.isArray(ledger.history)) {
    throw new TypeError("invalid review candidate ledger collections");
  }
}

function clone(value) {
  return structuredClone(value);
}

function nextSequence(ledger) {
  return ledger.history.length + 1;
}

function appendHistory(ledger, event) {
  ledger.history.push({ sequence: nextSequence(ledger), ...clone(event) });
}

export function candidateFingerprint(candidate) {
  requireString(candidate?.axis, "candidate.axis");
  requireString(candidate?.claim, "candidate.claim");
  const location = candidate.location ?? {};
  return sha256({
    axis: candidate.axis,
    claim: candidate.claim.trim().replace(/\s+/g, " ").toLowerCase(),
    file: location.file ?? null,
    lines: location.lines ?? null,
    category: candidate.category ?? null,
    runtimeTrigger: candidate.runtimeTrigger ?? null,
  });
}

export function createCandidateLedger({ repo, baseSha, headSha, runId = null }) {
  requireString(repo, "repo");
  requireString(baseSha, "baseSha");
  requireString(headSha, "headSha");
  return {
    schemaVersion: 1,
    kind: "github-delivery/review-candidate-ledger",
    repo,
    baseSha,
    headSha,
    runId,
    candidates: [],
    history: [],
  };
}

export function assertCandidateLedgerHead(ledger, expectedHeadSha) {
  requireLedger(ledger);
  if (ledger.headSha !== expectedHeadSha) {
    throw new Error(`stale candidate ledger: expected ${expectedHeadSha}, got ${ledger.headSha}`);
  }
  return true;
}

export function addReviewCandidate(ledger, candidate) {
  requireLedger(ledger);
  requireString(candidate?.findingId, "candidate.findingId");
  requireString(candidate?.axis, "candidate.axis");
  requireString(candidate?.producer, "candidate.producer");
  requireString(candidate?.claim, "candidate.claim");
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
    throw new TypeError("candidate.evidence must contain at least one evidence item");
  }
  if (ledger.candidates.some((item) => item.findingId === candidate.findingId)) {
    throw new Error(`duplicate finding id ${candidate.findingId}`);
  }

  const fingerprint = candidateFingerprint(candidate);
  const existing = ledger.candidates.find((item) => item.fingerprint === fingerprint);
  if (existing) {
    if (!existing.producers.includes(candidate.producer)) existing.producers.push(candidate.producer);
    existing.evidence.push(...clone(candidate.evidence));
    appendHistory(ledger, {
      type: "candidate-deduplicated",
      findingId: existing.findingId,
      duplicateFindingId: candidate.findingId,
      producer: candidate.producer,
    });
    return { status: "deduplicated", findingId: existing.findingId, fingerprint };
  }

  const record = {
    findingId: candidate.findingId,
    axis: candidate.axis,
    category: candidate.category ?? null,
    claim: candidate.claim,
    location: clone(candidate.location ?? null),
    runtimeTrigger: candidate.runtimeTrigger ?? null,
    severity: candidate.severity ?? null,
    confidence: candidate.confidence ?? null,
    fingerprint,
    producer: candidate.producer,
    producers: [candidate.producer],
    evidence: clone(candidate.evidence),
    state: "candidate",
    validation: null,
    arbitration: null,
    parentFindingId: candidate.parentFindingId ?? null,
  };
  ledger.candidates.push(record);
  appendHistory(ledger, { type: "candidate-added", findingId: record.findingId, producer: record.producer });
  return { status: "added", findingId: record.findingId, fingerprint };
}

function findCandidate(ledger, findingId) {
  requireLedger(ledger);
  const candidate = ledger.candidates.find((item) => item.findingId === findingId);
  if (!candidate) throw new Error(`unknown finding ${findingId}`);
  return candidate;
}

export function recordCandidateValidation(ledger, findingId, validation) {
  const candidate = findCandidate(ledger, findingId);
  requireString(validation?.validator, "validation.validator");
  if (!VALIDATION_VERDICTS.includes(validation.verdict)) {
    throw new TypeError(`unknown validation verdict: ${validation?.verdict}`);
  }
  if (candidate.producers.includes(validation.validator)) {
    throw new Error(`validator ${validation.validator} cannot validate its own discovery ${findingId}`);
  }
  if (validation.newFinding || validation.newCandidate || validation.confirmedNewClaim) {
    throw new Error("validation cannot self-confirm a newly discovered claim; enqueue it as a new candidate");
  }
  if (!Array.isArray(validation.evidence) || validation.evidence.length === 0) {
    throw new TypeError("validation.evidence must contain at least one evidence item");
  }

  candidate.validation = clone(validation);
  candidate.state = validation.verdict === "accept"
    ? "validated"
    : validation.verdict === "reject"
      ? "rejected"
      : "needs-more-evidence";
  appendHistory(ledger, {
    type: "candidate-validated",
    findingId,
    validator: validation.validator,
    verdict: validation.verdict,
  });
  return clone(candidate);
}

export function enqueueValidationDiscovery(ledger, parentFindingId, candidate, validator) {
  const parent = findCandidate(ledger, parentFindingId);
  requireString(validator, "validator");
  if (parent.producers.includes(validator)) {
    throw new Error("the original producer cannot use validation-discovery routing to self-confirm a sibling claim");
  }
  return addReviewCandidate(ledger, {
    ...clone(candidate),
    producer: validator,
    parentFindingId,
  });
}

export function recordCandidateArbitration(ledger, findingId, arbitration) {
  const candidate = findCandidate(ledger, findingId);
  requireString(arbitration?.arbiter, "arbitration.arbiter");
  if (!candidate.validation) throw new Error(`cannot arbitrate ${findingId} before validation`);
  if (candidate.producers.includes(arbitration.arbiter) || candidate.validation.validator === arbitration.arbiter) {
    throw new Error(`arbiter ${arbitration.arbiter} must be independent of discovery and validation for ${findingId}`);
  }
  if (!(["confirmed", "dismissed", "manual-review"].includes(arbitration.verdict))) {
    throw new TypeError(`unknown arbitration verdict: ${arbitration?.verdict}`);
  }
  if (!Array.isArray(arbitration.evidence) || arbitration.evidence.length === 0) {
    throw new TypeError("arbitration.evidence must contain at least one evidence item");
  }

  candidate.arbitration = clone(arbitration);
  candidate.state = arbitration.verdict === "confirmed"
    ? "validated"
    : arbitration.verdict === "dismissed"
      ? "rejected"
      : "manual-review";
  appendHistory(ledger, {
    type: "candidate-arbitrated",
    findingId,
    arbiter: arbitration.arbiter,
    verdict: arbitration.verdict,
  });
  return clone(candidate);
}

export function candidateLedgerSummary(ledger) {
  requireLedger(ledger);
  const byState = Object.fromEntries(CANDIDATE_STATES.map((state) => [state, 0]));
  for (const candidate of ledger.candidates) byState[candidate.state] += 1;
  return {
    repo: ledger.repo,
    baseSha: ledger.baseSha,
    headSha: ledger.headSha,
    runId: ledger.runId,
    candidateCount: ledger.candidates.length,
    byState,
    unresolved: ledger.candidates
      .filter((item) => ["candidate", "needs-more-evidence", "manual-review"].includes(item.state))
      .map((item) => item.findingId),
  };
}
