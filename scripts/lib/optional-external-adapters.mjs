const RED_TEAM_ADAPTERS = new Set(["promptfoo", "pyrit"]);
const HUMAN_REVIEW_SURFACES = new Set(["markdown", "html", "localhost"]);

function capabilityStatus(inventory, id) {
  if (!inventory || inventory.kind !== "github-delivery/capability-inventory") return "unknown";
  return inventory.capabilities?.[id]?.status || "unavailable";
}

function baseResult(adapter) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/optional-adapter-plan",
    adapter,
    status: "blocked",
    blockers: [],
    invocation: null,
    installAllowed: false,
    installAttempted: false,
    blocking: false,
    evidenceRole: null,
    satisfiesShipGate: false,
    satisfiesNativeReview: false,
    satisfiesSecurityReview: false,
    preferredForCodingAgents: adapter === "promptfoo",
    evidenceRequirements: [],
  };
}

function finishUnavailable(result, capability) {
  result.status = "unavailable";
  result.blockers.push(`capability-unavailable:${capability}`);
  return result;
}

function planPromptfoo(input, result) {
  if (!input.explicitUserRequest) result.blockers.push("explicit-user-red-team-request-required");
  if (input.authorizedTarget !== true) result.blockers.push("authorized-target-required");
  if (result.blockers.length) return result;
  if (capabilityStatus(input.inventory, "promptfoo") !== "available") return finishUnavailable(result, "promptfoo");

  result.status = "ready";
  result.invocation = { command: "promptfoo", args: ["redteam", "run"] };
  result.blocking = input.requestedBlocking === true;
  result.evidenceRole = "external-candidate-producer";
  result.evidenceRequirements = [
    "fresh-disposable-checkout",
    "synthetic-eval-credentials-only",
    "trace-or-command-tool-evidence",
    "changed-file-and-protected-hash-evidence",
    "sidecar-or-host-verifier-when-available",
    "candidate-findings-revalidated-by-native-review",
  ];
  return result;
}

function planPyrit(input, result) {
  if (!input.explicitUserRequest) result.blockers.push("explicit-user-red-team-request-required");
  if (input.authorizedTarget !== true) result.blockers.push("authorized-target-required");
  if (!input.scenarioId || typeof input.scenarioId !== "string") result.blockers.push("pyrit-scenario-required");
  if (!input.pyritTarget || typeof input.pyritTarget !== "string") result.blockers.push("pyrit-target-required");
  if (result.blockers.length) return result;
  if (capabilityStatus(input.inventory, "pyrit") !== "available") return finishUnavailable(result, "pyrit");

  result.status = "ready";
  result.invocation = { command: "pyrit_scan", args: [input.scenarioId, "--target", input.pyritTarget] };
  result.blocking = input.requestedBlocking === true;
  result.evidenceRole = "external-candidate-producer";
  result.preferredForCodingAgents = false;
  result.evidenceRequirements = [
    "explicit-scenario-and-target",
    "authorized-test-system",
    "isolated-or-test-environment-where-feasible",
    "conversation-and-score-artifacts",
    "candidate-findings-revalidated-by-native-review",
  ];
  return result;
}

function planHumanReview(input, result) {
  if (!input.explicitUserRequest) result.blockers.push("explicit-user-human-review-request-required");
  if (!HUMAN_REVIEW_SURFACES.has(input.targetKind)) result.blockers.push("human-review-surface-not-supported");
  if (!input.target || typeof input.target !== "string") result.blockers.push("human-review-target-required");
  if (result.blockers.length) return result;
  if (capabilityStatus(input.inventory, "human-review") !== "available") return finishUnavailable(result, "human-review");

  result.status = "ready";
  result.invocation = { command: "human-review", args: [input.target] };
  result.evidenceRole = "human-content-feedback";
  result.evidenceRequirements = [
    "apply-exact-human-edits-verbatim-when-requested",
    "preserve-batched-comments-as-human-feedback",
    "rerun-native-validation-after-source-changes",
  ];
  return result;
}

export function planOptionalAdapter(input = {}) {
  const adapter = input.adapter;
  if (!adapter || !["promptfoo", "pyrit", "human-review"].includes(adapter)) {
    throw new TypeError(`unknown optional adapter: ${adapter || "<missing>"}`);
  }

  const result = baseResult(adapter);
  if (RED_TEAM_ADAPTERS.has(adapter)) {
    result.satisfiesSecurityReview = false;
    result.satisfiesNativeReview = false;
    result.satisfiesShipGate = false;
  }

  if (adapter === "promptfoo") return planPromptfoo(input, result);
  if (adapter === "pyrit") return planPyrit(input, result);
  return planHumanReview(input, result);
}
