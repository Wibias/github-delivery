function blockerValue(componentName, blocker) {
  if (typeof blocker === "string") return `${componentName}:${blocker}`;
  const reason = blocker?.reason || "blocked";
  const key = blocker?.key || blocker?.id || null;
  return key
    ? `${componentName}:${reason}:${key}`
    : `${componentName}:${reason}`;
}

function unknownValue(componentName, unknown) {
  if (typeof unknown === "string") return `${componentName}:${unknown}`;
  const reason = unknown?.reason || unknown?.source || "unknown";
  return `${componentName}:${reason}`;
}

function componentSummary(component) {
  return {
    decision: component?.decision || "unknown",
    complete: component?.complete === true,
    blockerCount: Array.isArray(component?.blockers)
      ? component.blockers.length
      : 0,
    unknownCount: Array.isArray(component?.unknowns)
      ? component.unknowns.length
      : 0,
  };
}

export function combineShipGateResults({
  snapshot,
  requiredChecks,
  baseHealth,
  reviewPolicy,
  reviewThreads,
  wake,
  codeowners,
} = {}) {
  const authoritative = {
    requiredChecks,
    baseHealth,
    reviewPolicy,
    reviewThreads,
    wake,
  };
  const blockers = [];
  const unknowns = [];

  for (const [name, component] of Object.entries(authoritative)) {
    for (const blocker of component?.blockers || []) {
      blockers.push(blockerValue(name, blocker));
    }
    for (const unknown of component?.unknowns || []) {
      unknowns.push(unknownValue(name, unknown));
    }
    if (component?.decision === "blocked" && !(component?.blockers || []).length) {
      blockers.push(`${name}:blocked`);
    }
    if (
      (component?.decision === "unknown" || component?.complete !== true) &&
      !(component?.unknowns || []).length
    ) {
      unknowns.push(`${name}:incomplete`);
    }
  }

  const advisories = [];
  if (codeowners?.complete !== true) {
    advisories.push({
      code: "codeowners_incomplete",
      message: "Advisory CODEOWNERS evidence is incomplete.",
    });
  }
  if ((codeowners?.codeownersErrors || []).length) {
    advisories.push({
      code: "codeowners_parse_errors",
      count: codeowners.codeownersErrors.length,
      message: "GitHub reported CODEOWNERS parse errors.",
    });
  }
  const workflowWarning = reviewPolicy?.mergeGroupWorkflowCoverage?.warning;
  if (workflowWarning) {
    advisories.push({
      code: "merge_group_workflow_warning",
      message: workflowWarning,
    });
  }
  if ((baseHealth?.baseOnlyFailures || []).length) {
    advisories.push({
      code: "base_only_failures",
      count: baseHealth.baseOnlyFailures.length,
      message:
        "The base tip has failures that are not present on this PR head; track them separately without expanding this PR.",
    });
  }
  if ((baseHealth?.sharedFailures || []).length) {
    advisories.push({
      code: "base_preexisting_failures",
      count: baseHealth.sharedFailures.length,
      message:
        "The same failures are present on the base tip. They may block merging, but they do not automatically belong in this PR's implementation scope.",
    });
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueUnknowns = [...new Set(unknowns)];
  const decision = uniqueBlockers.length
    ? "blocked"
    : uniqueUnknowns.length
      ? "unknown"
      : "ready";

  return {
    schemaVersion: 1,
    kind: "shipping-github/ship-gate-decision",
    snapshotId: snapshot?.snapshotId || null,
    repo: snapshot?.repo || null,
    pr: snapshot?.pr || null,
    headOid: snapshot?.headOid || null,
    url: snapshot?.evidence?.pullRequest?.url || null,
    decision,
    ready: decision === "ready",
    blocked: decision === "blocked",
    unknown: decision === "unknown",
    complete: uniqueUnknowns.length === 0,
    blockers: uniqueBlockers,
    unknowns: uniqueUnknowns,
    advisories,
    components: {
      requiredChecks: componentSummary(requiredChecks),
      baseHealth: {
        ...componentSummary(baseHealth),
        baseOid: baseHealth?.baseOid || null,
        comparisonRequired: baseHealth?.comparisonRequired === true,
        sharedFailureCount: (baseHealth?.sharedFailures || []).length,
        prOnlyFailureCount: (baseHealth?.prOnlyFailures || []).length,
        unknownFailureCount: (baseHealth?.unknownFailures || []).length,
        baseOnlyFailureCount: (baseHealth?.baseOnlyFailures || []).length,
        scopeRecommendation: baseHealth?.scopeRecommendation || "investigate",
      },
      reviewPolicy: componentSummary(reviewPolicy),
      reviewThreads: componentSummary(reviewThreads),
      wake: componentSummary(wake),
      codeowners: {
        decision: codeowners?.decision || "unknown",
        complete: codeowners?.complete === true,
        authority: "advisory",
        ownerCount: (codeowners?.ownersUnion || []).length,
        errorCount: (codeowners?.codeownersErrors || []).length,
      },
    },
  };
}
