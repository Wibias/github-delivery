const GENERATIVE_LENSES = new Set([
  "parsing_serialization",
  "boundary_conditions",
  "input_shape",
  "malformed_input_robustness",
]);

const STATEFUL_LENSES = new Set([
  "concurrency_races",
  "retry_idempotency",
  "state_consistency",
  "filesystem_atomicity",
  "resource_lifecycle",
]);

const FAULT_LENSES = new Set([
  "retry_idempotency",
  "filesystem_atomicity",
  "network_cancellation",
  "error_propagation",
]);

const INVARIANT_SECURITY_DOMAINS = new Set([
  "authz",
  "business_logic",
  "data_storage",
  "crypto_session",
]);

function unique(values) {
  return [...new Set(values)];
}

function add(methods, reasons, method, reason) {
  methods.add(method);
  if (!reasons[method]) reasons[method] = [];
  if (!reasons[method].includes(reason)) reasons[method].push(reason);
}

function bugLensIds(plan) {
  const ids = new Set(plan?.bugReview?.requiredLenses || []);
  for (const lens of plan?.bugLenses || []) {
    if (lens?.required && lens.id) ids.add(lens.id);
  }
  return ids;
}

function securityDomainIds(plan) {
  const ids = new Set(plan?.securityReview?.requiredDomains || []);
  for (const domain of plan?.domains || []) {
    if (domain?.required && domain?.category === "security" && domain.id) ids.add(domain.id);
  }
  return ids;
}

function obligation(plan) {
  if (plan?.bugReview?.depth === "deep" || plan?.securityReview?.depth === "full") return "required-when-feasible";
  if (plan?.bugReview?.depth === "targeted" || plan?.securityReview?.depth === "targeted") return "recommended";
  return "none";
}

export function planVerificationMethods(plan = {}) {
  const methods = new Set();
  const reasons = {};
  const lenses = bugLensIds(plan);
  const domains = securityDomainIds(plan);
  const probes = new Set(plan.requiredProbes || []);

  for (const lens of lenses) {
    if (GENERATIVE_LENSES.has(lens)) {
      add(methods, reasons, "property-based", `bug lens ${lens}`);
      add(methods, reasons, "fuzz", `bug lens ${lens}`);
    }
    if (STATEFUL_LENSES.has(lens)) {
      add(methods, reasons, "invariant", `bug lens ${lens}`);
      add(methods, reasons, "state-machine", `bug lens ${lens}`);
    }
    if (FAULT_LENSES.has(lens)) {
      add(methods, reasons, "fault-injection", `bug lens ${lens}`);
    }
  }

  if (probes.has("malformed-input-robustness")) {
    add(methods, reasons, "property-based", "probe malformed-input-robustness");
    add(methods, reasons, "fuzz", "probe malformed-input-robustness");
  }
  if (probes.has("recursion-termination")) {
    add(methods, reasons, "property-based", "probe recursion-termination");
    add(methods, reasons, "bounded-generative", "probe recursion-termination");
  }
  if (probes.has("lock-error-propagation")) {
    add(methods, reasons, "invariant", "probe lock-error-propagation");
    add(methods, reasons, "fault-injection", "probe lock-error-propagation");
  }

  for (const domain of domains) {
    if (INVARIANT_SECURITY_DOMAINS.has(domain)) {
      add(methods, reasons, "invariant", `security domain ${domain}`);
    }
  }

  const mode = obligation(plan);
  const selected = unique([...methods]).sort();
  const requiredMethods = mode === "required-when-feasible" ? selected : [];
  const recommendedMethods = mode === "recommended" ? selected : [];

  return {
    schemaVersion: 1,
    kind: "github-delivery/verification-method-plan",
    obligation: mode,
    requiredMethods,
    recommendedMethods,
    reasons,
    adversarialAuthorized: false,
    instructions: [
      "Prefer an executable property/invariant/state-machine/fuzz check when the routed method can prove a high-risk behavior more directly than prose review.",
      "Required-when-feasible means record the concrete reason when the repository/runtime cannot support the routed method; never fake execution evidence.",
      "Generated inputs must stay inside authorized local/test fixtures and must not become permission to attack third-party production systems.",
      "Verification routing does not authorize the optional adversarial/red-team pass.",
    ],
  };
}
