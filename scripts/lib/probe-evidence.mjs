// Probe-application evidence: the machine-checkable record a review must emit
// to prove it applied a required probe to the diff.
//
// Contract (mirrors the verdict publication gate):
// - The scope projection (`projectBugScope` / `projectSecurityScope`) lists
//   `requiredProbes` (ids that fired on this diff) plus `probeEvidence`
//   (per-probe trigger files).
// - The review records one entry per required probe with:
//   status: "clean" | "findings" | "n-a"
//   - "clean": the probe was applied to every trigger file and nothing was found.
//   - "findings": at least one concrete finding card; `files` lists the files
//     reviewed (each must be a probe trigger file unless `files` is empty).
//   - "n-a": permitted only when the deterministic scope has no trigger files;
//     a required probe with trigger files cannot be downgraded by model prose.
// - A probe is complete only when its evidence passes all checks here.
//
// "files" for "clean" is optional (a clean probe may record the files walked).
// For "findings" it is required and must be non-empty. Files must belong to the
// probe's trigger files (files the scope engine saw fire the probe), unless the
// evidence explicitly records an extra file with "extraFiles": true — we keep
// the strict rule: every listed file must be a known trigger file.

import { PROBE_BY_ID } from "./probe-registry.mjs";

export const PROBE_EVIDENCE_SCHEMA_VERSION = 1;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate one probe-evidence record against its probe's trigger files.
 *
 * @param {object} record   { probeId, status, reason, files, findings }
 * @param {object} options  { triggerFiles, required }
 * @returns {Array<{code: string, message?: string}>}
 */
export function validateProbeEvidenceRecord(record, { triggerFiles = [], required = true } = {}) {
  const errors = [];
  if (!record || typeof record !== "object") {
    return [{ code: "evidence_not_object", message: "probe evidence must be an object" }];
  }
  const { probeId, status, reason, files } = record;
  if (!isNonEmptyString(probeId)) {
    errors.push({ code: "evidence_missing_probe_id" });
  } else if (!PROBE_BY_ID.has(probeId)) {
    errors.push({ code: "evidence_unknown_probe", probeId });
  }
  if (!["clean", "findings", "n-a"].includes(status)) {
    errors.push({ code: "evidence_invalid_status", probeId, status: status ?? null });
  }
  if (status === "n-a" && !isNonEmptyString(reason)) {
    errors.push({ code: "evidence_na_requires_reason", probeId });
  }
  if (status === "n-a" && required && triggerFiles.length > 0) {
    errors.push({ code: "evidence_required_probe_cannot_be_na", probeId, triggerFiles });
  }
  if (status !== "n-a" && isNonEmptyString(reason)) {
    errors.push({ code: "evidence_unexpected_reason", probeId });
  }
  const fileList = Array.isArray(files) ? files : [];
  if (status === "findings" && fileList.length === 0) {
    errors.push({ code: "evidence_findings_require_files", probeId });
  }
  if (status === "clean" && fileList.length === 0) {
    // A clean probe may omit files only when there is nothing to walk; the
    // caller decides strictness via `required`. Default: allow.
    if (required === false) errors.push({ code: "evidence_clean_requires_files", probeId });
  }
  if (required && !triggerFiles.length && status !== "n-a") {
    errors.push({ code: "evidence_no_trigger_files", probeId });
  }
  for (const file of fileList) {
    if (!triggerFiles.includes(file)) {
      errors.push({ code: "evidence_file_not_trigger_file", probeId, file, triggerFiles });
    }
  }
  return errors;
}

/**
 * Validate a full probe-evidence map (`{ probeId: record }`) against the
 * required probe set and each probe's trigger files.
 *
 * @param {object} evidence     probe id -> record
 * @param {object} scope        { requiredProbes: string[], probeEvidence: {id: {files}} }
 * @returns {Array<{code: string, probeId?: string, message?: string}>}
 */
export function validateProbeEvidence(evidence, scope) {
  const errors = [];
  const requiredProbes = Array.isArray(scope?.requiredProbes) ? scope.requiredProbes : [];
  const probeEvidence = (scope?.probeEvidence || {});
  const evidenceMap = evidence && typeof evidence === "object" ? evidence : {};
  const provided = new Set(Object.keys(evidenceMap));

  for (const probeId of requiredProbes) {
    if (!provided.has(probeId)) {
      errors.push({ code: "probe_evidence_missing", probeId });
      continue;
    }
    const triggerFiles = probeEvidence[probeId]?.files || [];
    // The evidence map is keyed by probe id; stamp it in so the record
    // validator can check it without requiring the agent to duplicate it.
    const record = { probeId, ...(evidenceMap[probeId] || {}) };
    const recordErrors = validateProbeEvidenceRecord(record, { triggerFiles });
    errors.push(...recordErrors.map((error) => ({ ...error, probeId })));
  }

  // Extra evidence for a probe that is not required is a contract violation
  // (it signals the agent applied a probe the scope engine did not fire, which
  // should have been recorded in the scope plan instead).
  for (const probeId of provided) {
    if (!requiredProbes.includes(probeId)) {
      errors.push({ code: "probe_evidence_not_required", probeId });
    }
  }

  return errors;
}

export function summarizeProbeEvidence(errors) {
  return {
    valid: errors.length === 0,
    missing: errors.filter((e) => e.code === "probe_evidence_missing").map((e) => e.probeId),
    invalid: errors.filter((e) => e.code !== "probe_evidence_missing").map((e) => e.probeId),
  };
}
