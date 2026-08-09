function requiredString(value, code) {
  const text = String(value || "").trim();
  if (!text) throw new Error(code);
  return text;
}

function strictRequiredChecks(snapshot = {}) {
  const rules = snapshot?.evidence?.activeRules;
  if (!Array.isArray(rules)) return false;
  const rule = rules.find((row) => row?.type === "required_status_checks");
  return rule?.parameters?.strict_required_status_checks_policy === true;
}

function mergeQueueEnabled(snapshot = {}) {
  return snapshot?.evidence?.policy?.mergeQueue?.enabled === true;
}

export function mergeBoundaryForSnapshot(snapshot = {}) {
  const capture = snapshot?.evidence?.captureBoundary || {};
  const headOid = requiredString(snapshot?.headOid || capture.headOid, "merge_boundary_head_missing").toLowerCase();
  const baseRefName = requiredString(capture.baseRefName, "merge_boundary_base_ref_missing");
  const baseOid = requiredString(capture.baseOid, "merge_boundary_base_oid_missing").toLowerCase();
  const rulesFingerprint = requiredString(capture.rulesFingerprint, "merge_boundary_rules_fingerprint_missing").toLowerCase();
  const coherence = strictRequiredChecks(snapshot)
    ? "strict_required_checks"
    : mergeQueueEnabled(snapshot)
      ? "merge_queue"
      : null;
  if (!coherence) {
    throw new Error(
      "merge_boundary_not_server_enforced: require strict required checks or merge queue before direct merge",
    );
  }
  return Object.freeze({
    headOid,
    baseRefName,
    baseOid,
    rulesFingerprint,
    coherence,
  });
}

export function assertSameMergeBoundary(expected = {}, snapshot = {}) {
  const observed = mergeBoundaryForSnapshot(snapshot);
  for (const field of ["headOid", "baseRefName", "baseOid", "rulesFingerprint", "coherence"]) {
    if (observed[field] !== expected[field]) {
      throw new Error(
        `merge_boundary_moved:${field}: expected ${expected[field] || "missing"}, observed ${observed[field] || "missing"}`,
      );
    }
  }
  return observed;
}
