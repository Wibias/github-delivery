const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const CAPABILITY_KEYS = ["scripts", "network", "credentials", "externalTools", "githubWrite"];

function declaredCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  for (const key of CAPABILITY_KEYS) normalized[key] = value[key] === true;
  return normalized;
}

function riskTier(capabilities) {
  if (!capabilities) return "unknown";
  if (capabilities.credentials || capabilities.githubWrite || (capabilities.scripts && capabilities.network)) return "high";
  if (capabilities.scripts || capabilities.network || capabilities.externalTools) return "medium";
  return "low";
}

function scanKinds(scans) {
  return new Set((Array.isArray(scans) ? scans : []).map((scan) => scan?.kind).filter(Boolean));
}

function scannerLeads(scans) {
  const leads = [];
  for (const scan of Array.isArray(scans) ? scans : []) {
    if (scan?.status !== "findings") continue;
    for (const finding of Array.isArray(scan.findings) ? scan.findings : []) {
      leads.push({ tool: String(scan.tool || "unknown"), kind: String(scan.kind || "unknown"), finding: String(finding) });
    }
  }
  return leads;
}

function confirmedBlockers(findings) {
  const blockers = [];
  for (const finding of Array.isArray(findings) ? findings : []) {
    const severity = String(finding?.severity || "").toLowerCase();
    const verdict = String(finding?.verdict || "").toLowerCase();
    if (verdict === "confirmed" && (severity === "high" || severity === "critical")) {
      blockers.push(`confirmed-${severity}:${finding.id || "unnamed"}`);
    }
  }
  return blockers;
}

function missingRiskControls(input, tier) {
  const kinds = scanKinds(input.scans);
  const missing = [];
  if ((tier === "medium" || tier === "high") && !kinds.has("static")) missing.push("static-scan");
  if (tier === "high") {
    if (!kinds.has("semantic")) missing.push("semantic-scan");
    if (!input.runtimeContainment || typeof input.runtimeContainment !== "object") missing.push("runtime-containment");
    if (!input.provenance || typeof input.provenance !== "object") missing.push("provenance");
    if (input.humanApproval?.approved !== true) missing.push("human-approval");
  }
  return missing;
}

export function planSkillAdmission(input = {}) {
  const blockers = [];
  if (!input.source || typeof input.source !== "string") blockers.push("source-required");
  if (!SHA40_RE.test(String(input.commitSha || ""))) blockers.push("immutable-commit-required");
  if (!SHA256_RE.test(String(input.contentSha256 || ""))) blockers.push("content-hash-required");
  if (!input.license || typeof input.license !== "string") blockers.push("license-required");

  const capabilities = declaredCapabilities(input.declaredCapabilities);
  if (!capabilities) blockers.push("declared-capabilities-required");
  const tier = riskTier(capabilities);
  const leads = scannerLeads(input.scans);
  blockers.push(...confirmedBlockers(input.validatedFindings));
  const missingControls = capabilities ? missingRiskControls(input, tier) : [];

  let decision = "eligible-for-human-review";
  if (blockers.length > 0) decision = "blocked";
  else if (missingControls.length > 0 || leads.length > 0) decision = "needs-review";

  return {
    schemaVersion: 1,
    kind: "github-delivery/skill-admission-plan",
    source: input.source ?? null,
    commitSha: input.commitSha ?? null,
    contentSha256: input.contentSha256 ?? null,
    license: input.license ?? null,
    declaredCapabilities: capabilities,
    riskTier: tier,
    decision,
    blockers,
    missingControls,
    scannerLeads: leads,
    provenance: input.provenance ? structuredClone(input.provenance) : null,
    runtimeContainment: input.runtimeContainment ? structuredClone(input.runtimeContainment) : null,
    humanApproval: input.humanApproval ? structuredClone(input.humanApproval) : null,
    trusted: false,
    installAuthorized: false,
    ignoredTrustSignals: ["popularity", "install-count", "stars", "single-clean-scanner"],
    instructions: [
      "Scanner output is candidate evidence. Validate meaningful findings before treating them as blockers.",
      "A clean scanner result never certifies a skill as trusted.",
      "Popularity and registry rank are discovery signals only and must not affect admission trust.",
      "High-risk skills require immutable identity, declared capabilities, static and semantic review evidence, provenance, runtime containment evidence, and explicit human approval before they are eligible for installation review.",
      "Eligibility is not installation authority; normal user/workflow mutation and execution authority still applies.",
    ],
  };
}
