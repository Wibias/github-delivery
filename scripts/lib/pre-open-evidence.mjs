/**
 * Validate review-completion evidence for the pre-open gate.
 *
 * Schema v2 binds every lens/surface completion record to the reviewed candidate
 * head plus bounded method/file provenance. Schema v1 is parsed only for legacy
 * in-process compatibility; the CLI publication path requires the current schema.
 * Deterministic probes retain their existing structured machine evidence and are
 * validated against the actual diff scope by `probe-evidence.mjs` inside the gate.
 */

export const PRE_OPEN_EVIDENCE_SCHEMA_VERSION = 2;
const LEGACY_PRE_OPEN_EVIDENCE_SCHEMA_VERSION = 1;
const MAX_METHOD_LENGTH = 120;
const MAX_REVIEWED_FILES = 200;
const MAX_REVIEWED_FILE_LENGTH = 1024;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} status
 * @param {string} id
 * @returns {string} the normalized status when valid, else an error message
 */
function normalizeStatus(status, id) {
  if (typeof status !== "string") return `status for ${id} must be a string`;
  const trimmed = status.trim();
  if (trimmed === "done") return "done";
  if (/^n\/a\s+\S/.test(trimmed)) return trimmed;
  if (trimmed === "n/a") return `invalid status for ${id}: "n/a" requires a reason, use "n/a <why>"`;
  return `invalid status for ${id}: ${JSON.stringify(trimmed)} (expected "done" or "n/a <why>")`;
}

function normalizeLegacyEvidenceBlock(block, prefix, errors) {
  const normalized = {};
  for (const [id, status] of Object.entries(block)) {
    const value = normalizeStatus(status, `${prefix}:${id}`);
    if (value === "done" || /^n\/a\s+\S/.test(value)) normalized[id] = value;
    else errors.push(value);
  }
  return normalized;
}

function normalizeReviewedFiles(value, id, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`structured review evidence for ${id} must include reviewedFiles`);
    return [];
  }
  if (value.length > MAX_REVIEWED_FILES) {
    errors.push(`reviewedFiles for ${id} exceeds ${MAX_REVIEWED_FILES} entries`);
    return [];
  }
  const normalized = [];
  const seen = new Set();
  for (const file of value) {
    if (typeof file !== "string") {
      errors.push(`reviewedFiles for ${id} must contain only strings`);
      continue;
    }
    const trimmed = file.trim();
    if (!trimmed || trimmed.length > MAX_REVIEWED_FILE_LENGTH) {
      errors.push(`reviewedFiles for ${id} contains an invalid path`);
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }
  if (normalized.length === 0) {
    errors.push(`structured review evidence for ${id} must include at least one valid reviewed file`);
  }
  return normalized;
}

function normalizeStructuredReviewEvidence(value, id, errors) {
  if (!isRecord(value)) {
    errors.push(`structured review evidence for ${id} must be an object`);
    return null;
  }

  const status = normalizeStatus(value.status, id);
  if (status !== "done" && !/^n\/a\s+\S/.test(status)) errors.push(status);

  const headSha = typeof value.headSha === "string" ? value.headSha.trim() : "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(headSha)) {
    errors.push(`structured review evidence for ${id} must include a Git object headSha`);
  }

  const method = typeof value.method === "string" ? value.method.trim() : "";
  if (!method || method.length > MAX_METHOD_LENGTH) {
    errors.push(`structured review evidence for ${id} must include a bounded method`);
  }

  const reviewedFiles = normalizeReviewedFiles(value.reviewedFiles, id, errors);
  if (
    (status !== "done" && !/^n\/a\s+\S/.test(status)) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(headSha) ||
    !method ||
    method.length > MAX_METHOD_LENGTH ||
    reviewedFiles.length === 0
  ) {
    return null;
  }

  return {
    status,
    headSha: headSha.toLowerCase(),
    method,
    reviewedFiles,
  };
}

function normalizeStructuredEvidenceBlock(block, prefix, errors) {
  const normalized = {};
  for (const [id, evidence] of Object.entries(block)) {
    const value = normalizeStructuredReviewEvidence(evidence, `${prefix}:${id}`, errors);
    if (value) normalized[id] = value;
  }
  return normalized;
}

/**
 * Validate a pre-open evidence payload.
 *
 * Schema v1 remains readable for legacy in-process callers. Publication uses
 * schema v2 and rejects legacy evidence in `pre-open-gate.mjs`.
 *
 * `probes` is optional. When present it is passed through as a probe-id ->
 * structured record map; scope-aware validation happens in the pre-open gate.
 */
export function validatePreOpenEvidence(input) {
  const errors = [];
  if (!isRecord(input)) return { ok: false, errors: ["evidence must be a JSON object"] };

  const schemaVersion = input.schemaVersion ?? LEGACY_PRE_OPEN_EVIDENCE_SCHEMA_VERSION;
  if (
    schemaVersion !== LEGACY_PRE_OPEN_EVIDENCE_SCHEMA_VERSION &&
    schemaVersion !== PRE_OPEN_EVIDENCE_SCHEMA_VERSION
  ) {
    errors.push(
      `evidence schemaVersion must be ${LEGACY_PRE_OPEN_EVIDENCE_SCHEMA_VERSION} or ${PRE_OPEN_EVIDENCE_SCHEMA_VERSION}`,
    );
  }

  const lensBlock = isRecord(input.lenses) ? input.lenses : {};
  const surfaceBlock = isRecord(input.surfaces) ? input.surfaces : {};
  const probeBlock = isRecord(input.probes) ? input.probes : {};
  if (!isRecord(input.lenses) || !isRecord(input.surfaces)) {
    errors.push("evidence must have object fields lenses and surfaces");
  }
  if (input.probes !== undefined && !isRecord(input.probes)) {
    errors.push("evidence probes must be an object when provided");
  }

  const structured = schemaVersion === PRE_OPEN_EVIDENCE_SCHEMA_VERSION;
  const lenses = structured
    ? normalizeStructuredEvidenceBlock(lensBlock, "lens", errors)
    : normalizeLegacyEvidenceBlock(lensBlock, "lens", errors);
  const surfaces = structured
    ? normalizeStructuredEvidenceBlock(surfaceBlock, "surface", errors)
    : normalizeLegacyEvidenceBlock(surfaceBlock, "surface", errors);
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    evidence: {
      schemaVersion,
      lenses,
      surfaces,
      probes: structuredClone(probeBlock),
    },
  };
}

function requiredReviewRow(reviewRows, axis, id, requirement, expectedHead) {
  const row = reviewRows?.[id];
  if (!isRecord(row)) throw new Error(`pre_open_review_${axis}_${id}_missing`);
  const errors = [];
  const normalized = normalizeStructuredReviewEvidence(row, `${axis}:${id}`, errors);
  if (!normalized || errors.length) {
    throw new Error(`pre_open_review_${axis}_${id}_invalid:${errors.join(";")}`);
  }
  if (normalized.headSha !== expectedHead) {
    throw new Error(`pre_open_review_${axis}_${id}_head_mismatch`);
  }
  const requiredFiles = Array.isArray(requirement?.reviewedFiles)
    ? [...new Set(requirement.reviewedFiles.map(String).filter(Boolean))]
    : [];
  const reviewedSet = new Set(normalized.reviewedFiles);
  if (requiredFiles.some((file) => !reviewedSet.has(file))) {
    throw new Error(`pre_open_review_${axis}_${id}_scope_mismatch`);
  }
  return normalized;
}

/**
 * Assemble exact schema-v2 evidence requested by a compact pre-open summary.
 *
 * Legacy schema-v1 aggregate declarations such as one candidate-wide
 * `bug: clean` / `security: clean` assertion are deliberately non-authoritative:
 * they cannot mint many semantic completion rows. Every required lens and
 * surface must be represented by its own head-bound structured review record.
 * The historical function name is retained for API compatibility.
 */
export function expandAggregatePreOpenEvidence(summary, review) {
  if (!isRecord(summary) || summary.kind !== "github-delivery/pre-open-gate-summary") {
    throw new Error("pre_open_review_summary_invalid");
  }
  if (!isRecord(review) || review.kind !== "github-delivery/pre-open-review-result") {
    throw new Error("pre_open_review_result_invalid");
  }
  if (review.schemaVersion !== PRE_OPEN_EVIDENCE_SCHEMA_VERSION) {
    if (review.schemaVersion === LEGACY_PRE_OPEN_EVIDENCE_SCHEMA_VERSION) {
      throw new Error("pre_open_review_aggregate_not_authoritative");
    }
    throw new Error("pre_open_review_result_invalid");
  }
  const requirements = summary.evidenceRequirements;
  if (!isRecord(requirements) || requirements.schemaVersion !== PRE_OPEN_EVIDENCE_SCHEMA_VERSION) {
    throw new Error("pre_open_review_requirements_invalid");
  }
  const expectedHead = String(requirements.headSha || summary.headRefOid || "").trim().toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(expectedHead)) {
    throw new Error("pre_open_review_head_invalid");
  }
  if (String(review.headSha || "").trim().toLowerCase() !== expectedHead) {
    throw new Error("pre_open_review_head_mismatch");
  }

  const lensRequirements = isRecord(requirements.lenses) ? requirements.lenses : {};
  const surfaceRequirements = isRecord(requirements.surfaces) ? requirements.surfaces : {};
  const reviewLenses = isRecord(review.lenses) ? review.lenses : {};
  const reviewSurfaces = isRecord(review.surfaces) ? review.surfaces : {};
  const lenses = {};
  for (const [id, requirement] of Object.entries(lensRequirements)) {
    lenses[id] = requiredReviewRow(reviewLenses, "lens", id, requirement, expectedHead);
  }
  const surfaces = {};
  for (const [id, requirement] of Object.entries(surfaceRequirements)) {
    surfaces[id] = requiredReviewRow(reviewSurfaces, "surface", id, requirement, expectedHead);
  }

  const reviewProbes = isRecord(review.probes) ? review.probes : {};
  const requiredProbeIds = Array.isArray(summary?.remaining?.probes)
    ? summary.remaining.probes.map(String)
    : Object.keys(isRecord(requirements.probes) ? requirements.probes : {});
  const probes = {};
  for (const id of requiredProbeIds) {
    if (!isRecord(reviewProbes[id])) throw new Error(`pre_open_review_probe_missing:${id}`);
    probes[id] = structuredClone(reviewProbes[id]);
  }

  const candidate = {
    schemaVersion: PRE_OPEN_EVIDENCE_SCHEMA_VERSION,
    lenses,
    surfaces,
    probes,
  };
  const validated = validatePreOpenEvidence(candidate);
  if (!validated.ok) throw new Error(`pre_open_review_evidence_invalid:${validated.errors.join(";")}`);
  return validated.evidence;
}

/**
 * Whether lens/surface evidence clears a required id.
 *
 * Passing `headSha` enables the current schema semantics and requires structured
 * provenance bound to that exact candidate head. Omitting it preserves legacy
 * in-process compatibility for callers that do not participate in publication.
 */
export function evidenceClears(map, id, options = null) {
  const evidence = map[id];
  const requiresHeadBinding =
    isRecord(options) && Object.prototype.hasOwnProperty.call(options, "headSha");

  if (!requiresHeadBinding) {
    if (typeof evidence === "string") {
      return evidence === "done" || evidence.startsWith("n/a ");
    }
    const errors = [];
    return Boolean(normalizeStructuredReviewEvidence(evidence, id, errors));
  }

  const expectedHead = typeof options.headSha === "string" ? options.headSha.trim() : "";
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(expectedHead)) return false;

  const errors = [];
  const normalized = normalizeStructuredReviewEvidence(evidence, id, errors);
  return Boolean(normalized && normalized.headSha === expectedHead.toLowerCase());
}
