/**
 * Validate review-completion evidence for the pre-open gate.
 *
 * The gate derives required scope from the diff shape. Evidence is the
 * machine-checkable record that each required lens/surface was actually
 * reviewed: `done` means the pass ran and found nothing needing a fix (or the
 * findings were fixed), `n/a (why)` means the boundary is untouched and the
 * reason is recorded. This module validates the evidence payload so the gate
 * can clear a `blocked` scope only for lenses/surfaces that carry valid
 * evidence, and never clear on malformed or self-asserted input.
 */

export const PRE_OPEN_EVIDENCE_SCHEMA_VERSION = 1;

const VALID_STATUSES = new Set(["done", "n/a"]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} status
 * @param {string} id
 * @returns {string | null} the normalized status when valid, else an error message
 */
function normalizeStatus(status, id) {
  if (typeof status !== "string") return `status for ${id} must be a string`;
  const trimmed = status.trim();
  if (trimmed === "done") return "done";
  if (/^n\/a\s+/.test(trimmed)) return trimmed;
  if (trimmed === "n/a") return `invalid status for ${id}: "n/a" requires a reason, use "n/a <why>"`;
  return `invalid status for ${id}: ${JSON.stringify(trimmed)} (expected "done" or "n/a <why>")`;
}

/**
 * Validate a pre-open evidence payload.
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
  const lenses = {};
  const surfaces = {};
  const lensBlock = isRecord(input.lenses) ? input.lenses : {};
  const surfaceBlock = isRecord(input.surfaces) ? input.surfaces : {};
  if (!isRecord(input.lenses) || !isRecord(input.surfaces)) {
    errors.push("evidence must have object fields lenses and surfaces");
  }
  for (const [id, status] of Object.entries(lensBlock)) {
    const normalized = normalizeStatus(status, `lens:${id}`);
    if (normalized === "done" || /^n\/a\s+\S/.test(normalized)) lenses[id] = normalized;
    else errors.push(normalized);
  }
  for (const [id, status] of Object.entries(surfaceBlock)) {
    const normalized = normalizeStatus(status, `surface:${id}`);
    if (normalized === "done" || /^n\/a\s+\S/.test(normalized)) surfaces[id] = normalized;
    else errors.push(normalized);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, evidence: { schemaVersion: PRE_OPEN_EVIDENCE_SCHEMA_VERSION, lenses, surfaces } };
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
