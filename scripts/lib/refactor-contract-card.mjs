const REQUIRED_DIMENSIONS = [
  "behavior",
  "apiAndData",
  "persistence",
  "performanceAndResources",
  "securityAndAuthorization",
  "compatibility",
  "errorsAndLogs",
  "sideEffects",
  "timingAndConcurrency",
];

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => String(item || "").trim().length > 0);
}

export function evaluateRefactorContractCard(card = {}) {
  const blockers = [];
  if (!card.candidateId || typeof card.candidateId !== "string") blockers.push("candidate-id-required");

  for (const field of REQUIRED_DIMENSIONS) {
    if (!nonEmptyArray(card[field])) blockers.push(`missing-contract:${field}`);
  }

  const tests = Array.isArray(card.tests) ? card.tests : [];
  if (tests.length === 0) blockers.push("verification-tests-required");
  for (const item of tests) {
    if (!item?.id || !item?.protects || item.wouldFailIfBroken !== true) {
      blockers.push(`dishonest-or-vacuous-test:${item?.id || "unnamed"}`);
    }
  }

  if (card.behaviorKnowledge === "poorly-documented-important") {
    if (!Array.isArray(card.characterizationEvidence) || card.characterizationEvidence.length === 0) {
      blockers.push("characterization-evidence-required");
    }
  }

  if (Array.isArray(card.unknowns) && card.unknowns.some((item) => String(item || "").trim())) {
    blockers.push("unresolved-equivalence-unknowns");
  }

  return {
    schemaVersion: 1,
    kind: "github-delivery/refactor-contract-card-evaluation",
    candidateId: card.candidateId ?? null,
    eligible: blockers.length === 0,
    blockers: [...new Set(blockers)],
    preservedDimensions: REQUIRED_DIMENSIONS.filter((field) => nonEmptyArray(card[field])),
    testCount: tests.length,
    characterizationRequired: card.behaviorKnowledge === "poorly-documented-important",
    instructions: [
      "Do not apply a simplification while any equivalence dimension is missing or unknown.",
      "A passing test only counts as protection when it would fail if the protected contract were broken.",
      "Add characterization evidence before restructuring important behavior that is poorly documented or weakly tested.",
      "Line-count reduction is not evidence of equivalence or success.",
    ],
  };
}

export const REFACTOR_CONTRACT_DIMENSIONS = Object.freeze([...REQUIRED_DIMENSIONS]);
