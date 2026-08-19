/**
 * Validate review-completion evidence for the pre-open gate.
 *
 * The gate derives required scope from the diff shape. Evidence is the
 * machine-checkable record that each required lens, surface, and probe was
 * actually reviewed: `done` means the pass ran and found nothing needing a fix
 * (or the findings were fixed), `n/a (why)` means the boundary is untouched and
 * the reason is recorded. This module validates the evidence payload so the gate
 * can clear a `blocked` obligation only for entries that carry valid evidence.
 */

export const PRE_OPEN_EVIDENCE_SCHEMA_VERSION = 1;

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
  if (/^n\/a\s+/.test(trimmed)) return trimmed;
  if (trimmed === "n/a") return `invalid status for ${id}: "n/a" requires a reason, use "n/a <why>"`;
  return `invalid status for ${id}: ${JSON.stringify(trimmed)} (expected "done" or "n/a <why>")`;
}

function normalizeEvidenceBlock(block, prefix, errors) {
  const normalized = {};
  for (const [id, status] of Object.entries(block)) {
    const value = normalizeStatus(status, `${prefix}:${id}`);
    if (value === "done" || /^n\/a\s+\S/.test(value)) normalized[id] = value;
    else errors.push(value);
  }
  return normalized;
}

/**
 * Validate a pre-open evidence payload.
 *
 * `probes` is optional for schema-version compatibility with older evidence.
 * Missing probe evidence never clears a newly required probe.
 *
 * @param {unknown} input
 * @returns {{ ok: true, evidence: PreOpenEvidence } | { ok: false, errors: string[] }}
 */
export function validatePreOpenEvidence(input) {
  const errors = [];
  if (!isRecord(input)) return { ok: false, errors: ["evidence must be a JSON object"] };
  if (input.schemaVersion !== undefined && input.schemaVersion !== PRE_OPEN_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`evidence schemaVersion must be ${PRE_OPEN_EVIDENCE_SCHEMA_VERSION}`);
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

  const lenses = normalizeEvidenceBlock(lensBlock, "lens", errors);
  const surfaces = normalizeEvidenceBlock(surfaceBlock, "surface", errors);
  const probes = normalizeEvidenceBlock(probeBlock, "probe", errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    evidence: {
      schemaVersion: PRE_OPEN_EVIDENCE_SCHEMA_VERSION,
      lenses,
      surfaces,
      probes,
    },
  };
}

/**
 * Whether evidence clears a required id.
 *
 * @param {Record<string, string>} map
 * @param {string} id
 * @returns {boolean}
 */
export function evidenceClears(map, id) {
  const status = map[id];
  return status === "done" || (typeof status === "string" && status.startsWith("n/a "));
}
