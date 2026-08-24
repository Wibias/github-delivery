// Probe-application evidence: the machine-checkable record a review must emit
// to prove it applied a required probe to the diff.
//
// Contract (mirrors the verdict publication gate):
// - The scope projection (`projectBugScope` / `projectSecurityScope`) lists
//   `requiredProbes` (ids that fired on this diff) plus `probeEvidence`
//   (per-probe trigger files).
// - The review records one entry per required probe with:
//   status: "clean" | "findings" | "n-a"
//   - "clean": the probe was applied to every trigger file and nothing was found;
//     `files` must list every trigger file exactly once.
//   - "findings": at least one concrete finding card; `files` lists the files
//     reviewed and every listed file must be a probe trigger file.
//   - "n-a": permitted only when the deterministic scope has no trigger files;
//     a required probe with trigger files cannot be downgraded by model prose.
// - A probe is complete only when its evidence passes all checks here.

import { PROBE_BY_ID } from "./probe-registry.mjs";

export const PROBE_EVIDENCE_SCHEMA_VERSION = 1;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values) {
  return [...new Set(values)];
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
  const uniqueFiles = unique(fileList);
  const expectedFiles = unique(triggerFiles);
  if (uniqueFiles.length !== fileList.length) {
    errors.push({ code: "evidence_files_duplicate", probeId });
  }
  if (status === "findings" && fileList.length === 0) {
    errors.push({ code: "evidence_findings_require_files", probeId });
  }
  if (status === "clean" && required && expectedFiles.length > 0) {
    if (fileList.length === 0) {
      errors.push({ code: "evidence_clean_requires_files", probeId });
    }
    const missing = expectedFiles.filter((file) => !uniqueFiles.includes(file));
    if (missing.length > 0) {
      errors.push({
        code: "evidence_clean_missing_trigger_files",
        probeId,
        missing,
        triggerFiles: expectedFiles,
      });
    }
  }
  if (required && expectedFiles.length === 0 && status !== "n-a") {
    errors.push({ code: "evidence_no_trigger_files", probeId });
  }
  for (const file of uniqueFiles) {
    if (!expectedFiles.includes(file)) {
      errors.push({ code: "evidence_file_not_trigger_file", probeId, file, triggerFiles: expectedFiles });
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
    const record = { probeId, ...(evidenceMap[probeId] || {}) };
    const recordErrors = validateProbeEvidenceRecord(record, { triggerFiles });
    errors.push(...recordErrors.map((error) => ({ ...error, probeId })));
  }

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
