import { createHash } from "node:crypto";

/**
 * GitHub returns this documented plan/feature gate for repository rules and
 * classic branch protection when a private repository is on a plan without
 * those features. The exact message and the per-endpoint documentation URL are
 * part of the evidence contract: anything else stays fail-closed.
 */
export const RULES_PLAN_MESSAGE =
  "Upgrade to GitHub Pro or make this repository public to enable this feature.";

export const RULES_BOUNDARY_EVIDENCE_KIND =
  "github-delivery/rules-boundary-evidence";
export const RULES_BOUNDARY_MODE = "plan_feature_unavailable";

const ENDPOINTS = Object.freeze({
  rulesets: Object.freeze({
    documentationUrl:
      "https://docs.github.com/rest/repos/rules#get-all-repository-rulesets",
  }),
  branchRules: Object.freeze({
    documentationUrl:
      "https://docs.github.com/rest/repos/rules#get-rules-for-a-branch",
  }),
  classicProtection: Object.freeze({
    documentationUrl:
      "https://docs.github.com/rest/branches/branch-protection#get-branch-protection",
  }),
});

const ENDPOINT_KEYS = Object.freeze(Object.keys(ENDPOINTS));

function stripAnsi(value) {
  return String(value || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function compact(value) {
  return stripAnsi(value).replace(/\s+/g, " ").trim();
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("rules_boundary_number_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("rules_boundary_value_invalid");
}

export function rulesBoundaryFingerprint(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/**
 * Parse a failed gh API response into a structured HTTP failure. Both the gh
 * stderr status line and the JSON error payload must agree; a missing,
 * duplicated, or mismatched status is ambiguous evidence.
 */
export function parseGitHubApiFailure(response = {}) {
  if (response?.ok === true) return { failure: null, reason: "probe_succeeded" };
  const errorText = compact(response?.error);
  if (!errorText) return { failure: null, reason: "error_text_missing" };

  const statusMatches = [...errorText.matchAll(/\(HTTP\s+(\d{3})\)/g)];
  if (statusMatches.length !== 1) {
    return { failure: null, reason: "http_status_ambiguous" };
  }
  const status = Number(statusMatches[0][1]);
  const errorMessage = errorText
    .slice(0, statusMatches[0].index)
    .replace(/^gh:\s*/i, "")
    .trim();

  let body = null;
  try {
    body = JSON.parse(String(response?.body || ""));
  } catch {
    return { failure: null, reason: "error_payload_invalid_json" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { failure: null, reason: "error_payload_missing" };
  }

  const bodyStatus = Number(body.status);
  if (!Number.isInteger(bodyStatus)) {
    return { failure: null, reason: "error_payload_status_missing" };
  }
  if (bodyStatus !== status) {
    return { failure: null, reason: "error_payload_status_mismatch" };
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return { failure: null, reason: "error_payload_message_missing" };
  }
  if (errorMessage && errorMessage !== message) {
    return { failure: null, reason: "error_text_message_mismatch" };
  }
  const documentationUrl =
    typeof body.documentation_url === "string"
      ? body.documentation_url.trim()
      : "";
  if (!documentationUrl) {
    return { failure: null, reason: "error_payload_documentation_url_missing" };
  }

  return {
    failure: { status, message, documentationUrl },
    reason: null,
  };
}

function classifyEndpointProbe(response, endpointKey) {
  const endpoint = ENDPOINTS[endpointKey];
  if (!endpoint) throw new Error("rules_boundary_endpoint_unknown");
  const parsed = parseGitHubApiFailure(response);
  if (!parsed.failure) {
    return {
      planGated: false,
      reason: `${endpointKey}_${parsed.reason || "probe_unreadable"}`,
    };
  }
  const failure = parsed.failure;
  if (failure.status !== 403) {
    return {
      planGated: false,
      reason: `${endpointKey}_http_${failure.status}`,
    };
  }
  if (failure.message !== RULES_PLAN_MESSAGE) {
    return {
      planGated: false,
      reason: `${endpointKey}_message_not_plan_gate`,
    };
  }
  if (failure.documentationUrl !== endpoint.documentationUrl) {
    return {
      planGated: false,
      reason: `${endpointKey}_documentation_url_mismatch`,
    };
  }
  return {
    planGated: true,
    evidence: { status: 403, documentationUrl: endpoint.documentationUrl },
  };
}

function emptyPolicyEvidence(policy) {
  const rules = policy?.branchProtectionRules;
  return (
    policy?.readable === true &&
    policy?.complete === true &&
    rules &&
    Array.isArray(rules.nodes) &&
    rules.nodes.length === 0 &&
    rules.pageInfo?.hasNextPage !== true
  );
}

function unprotectedBranchEvidence(branch) {
  const protection = branch?.protection;
  const required = protection?.required_status_checks;
  return (
    branch?.protected === false &&
    protection?.enabled === false &&
    required?.enforcement_level === "off" &&
    Array.isArray(required?.checks) &&
    required.checks.length === 0 &&
    Array.isArray(required?.contexts) &&
    required.contexts.length === 0
  );
}

/**
 * Accept a plan/feature-unavailable rules boundary only when every plan-gated
 * endpoint returns the exact documented response and independent structured
 * reads confirm the repository cannot have active rules. Any other combination
 * (permission denial, transient/server error, missing data, message variant,
 * conflicting evidence) stays unresolved and therefore fail-closed.
 */
export function classifyRulesPlanFeatureUnavailable({
  repo = null,
  branch = null,
  policy = null,
  probes = null,
} = {}) {
  const reasons = [];
  const endpoints = {};

  for (const key of ENDPOINT_KEYS) {
    const result = classifyEndpointProbe(probes?.[key], key);
    if (!result.planGated) reasons.push(result.reason);
    endpoints[key] = result.evidence || null;
  }

  if (
    !repo ||
    typeof repo !== "object" ||
    repo.private !== true ||
    repo.visibility !== "private"
  ) {
    reasons.push("repository_not_confirmed_private");
  }
  if (!unprotectedBranchEvidence(branch)) {
    reasons.push("branch_not_confirmed_unprotected");
  }
  if (!emptyPolicyEvidence(policy)) {
    reasons.push("classic_rules_not_confirmed_empty");
  }

  if (reasons.length) {
    return {
      determined: false,
      unavailable: false,
      reason: reasons[0],
      reasons,
      evidence: null,
    };
  }

  const evidence = {
    kind: RULES_BOUNDARY_EVIDENCE_KIND,
    schemaVersion: 1,
    mode: RULES_BOUNDARY_MODE,
    message: RULES_PLAN_MESSAGE,
    repo: { private: true, visibility: "private" },
    branch: {
      protected: false,
      protectionEnabled: false,
      requiredStatusChecksEnforcement: "off",
      requiredStatusCheckCount: 0,
      requiredStatusContextCount: 0,
    },
    policy: { branchProtectionRuleCount: 0, pageComplete: true },
    endpoints,
  };
  return {
    determined: true,
    unavailable: true,
    reason: null,
    reasons: [],
    evidence,
  };
}

/**
 * Revalidate a boundary evidence object that was carried through a snapshot.
 * Snapshot replay is diagnostic-only, but internally inconsistent evidence must
 * never be read as an authoritative absence of rules.
 */
export function validateRulesBoundaryEvidence(evidence = null) {
  const reasons = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { valid: false, reasons: ["rules_boundary_evidence_missing"] };
  }
  if (evidence.kind !== RULES_BOUNDARY_EVIDENCE_KIND) {
    reasons.push("rules_boundary_evidence_kind_invalid");
  }
  if (evidence.schemaVersion !== 1) {
    reasons.push("rules_boundary_evidence_schema_invalid");
  }
  if (evidence.mode !== RULES_BOUNDARY_MODE) {
    reasons.push("rules_boundary_mode_invalid");
  }
  if (evidence.message !== RULES_PLAN_MESSAGE) {
    reasons.push("rules_boundary_message_invalid");
  }
  if (evidence.repo?.private !== true || evidence.repo?.visibility !== "private") {
    reasons.push("rules_boundary_repository_invalid");
  }
  if (
    evidence.branch?.protected !== false ||
    evidence.branch?.protectionEnabled !== false ||
    evidence.branch?.requiredStatusChecksEnforcement !== "off" ||
    evidence.branch?.requiredStatusCheckCount !== 0 ||
    evidence.branch?.requiredStatusContextCount !== 0
  ) {
    reasons.push("rules_boundary_branch_invalid");
  }
  if (
    evidence.policy?.branchProtectionRuleCount !== 0 ||
    evidence.policy?.pageComplete !== true
  ) {
    reasons.push("rules_boundary_policy_invalid");
  }
  for (const key of ENDPOINT_KEYS) {
    if (
      evidence.endpoints?.[key]?.status !== 403 ||
      evidence.endpoints?.[key]?.documentationUrl !==
        ENDPOINTS[key].documentationUrl
    ) {
      reasons.push(`rules_boundary_endpoint_invalid:${key}`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}
