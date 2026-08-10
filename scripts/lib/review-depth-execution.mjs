const BUG_STAGES = Object.freeze({
  skip: [],
  baseline: [
    "bug-baseline-lenses",
    "bug-required-probes",
    "bug-coverage-evidence",
  ],
  targeted: [
    "bug-baseline-lenses",
    "bug-required-probes",
    "bug-targeted-lenses",
    "bug-adjacent-context",
    "bug-candidate-validation",
    "bug-coverage-evidence",
  ],
  deep: [
    "bug-baseline-lenses",
    "bug-required-probes",
    "bug-targeted-lenses",
    "bug-adjacent-context",
    "bug-finder-challenger-arbiter",
    "bug-cross-boundary-analysis",
    "bug-high-risk-runtime-or-property-check",
    "bug-coverage-gap-fill",
    "bug-coverage-evidence",
  ],
});

const SECURITY_STAGES = Object.freeze({
  skip: [],
  baseline: [
    "security-baseline-surfaces",
    "security-required-probes",
    "security-coverage-matrix",
  ],
  targeted: [
    "security-baseline-surfaces",
    "security-required-probes",
    "security-targeted-surfaces",
    "security-source-sink-validation",
    "security-static-leads",
    "security-candidate-validation",
    "security-coverage-matrix",
  ],
  full: [
    "security-baseline-surfaces",
    "security-required-probes",
    "security-targeted-surfaces",
    "security-source-sink-validation",
    "security-static-leads",
    "security-independent-validation",
    "security-attack-path-chain-analysis",
    "security-variant-analysis",
    "security-high-impact-benign-reproduction",
    "security-coverage-gap-fill",
    "security-coverage-matrix",
  ],
});

export const REVIEW_EXECUTION_STAGE_DESCRIPTIONS = Object.freeze({
  "bug-baseline-lenses": "Screen silent_failures, resource_leaks, and edge_cases without pretending every detailed lens is touched.",
  "bug-required-probes": "Apply every bug requiredProbes id and emit machine-checkable probe evidence.",
  "bug-targeted-lenses": "Inspect every evidence-required detailed bug lens and its trigger files.",
  "bug-adjacent-context": "Open only the adjacent source/callers/callees needed to settle triggered lenses.",
  "bug-candidate-validation": "Validate every candidate against actual source/runtime behavior before reporting it.",
  "bug-finder-challenger-arbiter": "Run the isolated Finder → Challenger → Arbiter method for deep bug review.",
  "bug-cross-boundary-analysis": "Trace assumption, error, state, type, auth, and partial-failure mismatches across changed boundaries.",
  "bug-high-risk-runtime-or-property-check": "Use a runtime reproduction, invariant/property test, or equivalent executable check for high-risk candidates when feasible.",
  "bug-coverage-gap-fill": "Target unreviewed files/lenses after the first pass; do not rescan already-covered areas just to add reviewers.",
  "bug-coverage-evidence": "Record complete/partial coverage honestly and keep unreviewed/manual candidates visible.",
  "security-baseline-surfaces": "Screen baseline authn, authz, secrets/config, and injection surfaces for logic-bearing diffs.",
  "security-required-probes": "Apply every security requiredProbes id and emit machine-checkable probe evidence.",
  "security-targeted-surfaces": "Inspect every evidence-required security surface and its trigger files.",
  "security-source-sink-validation": "Trace attacker-controlled source → propagation → sink/control → concrete impact before confirmation.",
  "security-static-leads": "Use secrets/static/dependency/dataflow tooling when applicable as lead producers, never as authority.",
  "security-candidate-validation": "Independently validate security candidates and downgrade unresolved hypotheses to Needs verification.",
  "security-independent-validation": "Use a validator independent from the candidate producer for full-depth security findings.",
  "security-attack-path-chain-analysis": "Trace complete exploit/privilege/data paths and required chains before assigning final severity.",
  "security-variant-analysis": "Search sibling paths/verbs/versions/patterns after a confirmed vulnerability.",
  "security-high-impact-benign-reproduction": "Require benign reproducibility evidence for confirmed Critical/High findings when safe and feasible.",
  "security-coverage-gap-fill": "Target uncovered required surfaces and attack classes rather than blindly multiplying reviewers.",
  "security-coverage-matrix": "Complete the required security coverage matrix with done/n-a evidence and residual risk.",
});

function stagesFor(table, depth, axis) {
  const stages = table[depth];
  if (!stages) throw new TypeError(`unknown ${axis} review depth: ${depth}`);
  return stages;
}

function stageRecords(ids) {
  return ids.map((id) => ({ id, required: true, description: REVIEW_EXECUTION_STAGE_DESCRIPTIONS[id] }));
}

export function planBugDepthExecution(bugScope) {
  if (!bugScope || typeof bugScope !== "object") throw new TypeError("bug scope is required");
  const depth = bugScope.bugReviewDepth;
  const ids = stagesFor(BUG_STAGES, depth, "bug");
  return {
    schemaVersion: 1,
    kind: "github-delivery/review-depth-execution",
    axis: "bug",
    depth,
    stages: stageRecords(ids),
    requiredStageIds: [...ids],
    forbiddenShortcuts: [
      "external-clean-result-cancels-native-review",
      "passing-tests-means-no-bug-review",
      "unreviewed-coverage-reported-clean",
      "auto-launch-deep-external-multi-agent-kit",
    ],
  };
}

export function planSecurityDepthExecution(securityScope) {
  if (!securityScope || typeof securityScope !== "object") throw new TypeError("security scope is required");
  const depth = securityScope.securityReviewDepth;
  const ids = stagesFor(SECURITY_STAGES, depth, "security");
  return {
    schemaVersion: 1,
    kind: "github-delivery/review-depth-execution",
    axis: "security",
    depth,
    stages: stageRecords(ids),
    requiredStageIds: [...ids],
    forbiddenShortcuts: [
      "external-clean-result-cancels-native-review",
      "green-ci-means-security-clean",
      "medium-confidence-promoted-to-confirmed-high",
      "auto-red-team-without-user-request",
      "unreviewed-required-surface-reported-clean",
    ],
  };
}

export function planReviewDepthExecution({ bugScope, securityScope }) {
  return {
    schemaVersion: 1,
    kind: "github-delivery/review-depth-execution-plan",
    bug: planBugDepthExecution(bugScope),
    security: planSecurityDepthExecution(securityScope),
  };
}
