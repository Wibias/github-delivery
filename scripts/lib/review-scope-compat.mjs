const SECURITY_BASELINES = ["authn", "authz", "secrets_config", "injection"];
const BUG_BASELINES = ["silent_failures", "resource_leaks", "edge_cases"];
const BUG_PROBES = new Set(["api-cli-wiring", "input-shape-evidence-semantics", "determinism-clocks-budgets", "recursion-termination", "cli-payload-completeness", "hot-path-scale", "malformed-input-robustness", "lock-error-propagation", "test-honesty", "ui-accessibility"]);
const SECURITY_PROBES = new Set(["credential-transport", "secrets-scan", "removed-controls"]);

function packageManager(files) {
  const joined = files.join("\n");
  if (/pnpm-lock\.yaml/i.test(joined)) return "pnpm";
  if (/yarn\.lock/i.test(joined)) return "yarn";
  if (/package-lock\.json/i.test(joined)) return "npm";
  if (/bun\.lock/i.test(joined)) return "bun";
  if (/Cargo\.(toml|lock)/i.test(joined)) return "cargo";
  if (/go\.(mod|sum)/i.test(joined)) return "go";
  if (/pyproject\.toml|requirements/i.test(joined)) return "python";
  return null;
}

function evidenceRow(item) {
  return {
    why: item.reasons.join("; "),
    files: item.files,
    confidence: item.confidence,
    score: item.score,
    excerpts: item.excerpts,
  };
}

export function projectSecurityScope(plan) {
  const evidenceRequired = plan.domains.filter((item) => item.category === "security" && item.required);
  const requiredIds = new Set(evidenceRequired.map((item) => item.id));
  if (plan.securityReview.depth !== "skip") {
    for (const id of SECURITY_BASELINES) requiredIds.add(id);
  }
  const matched = Object.fromEntries(evidenceRequired.map((item) => [item.id, evidenceRow(item)]));
  for (const id of SECURITY_BASELINES) {
    if (requiredIds.has(id) && !matched[id]) {
      matched[id] = {
        why: "baseline screen for logic-bearing diffs; record n/a with evidence when the boundary is untouched",
        files: [],
        confidence: "baseline",
        score: 0,
        excerpts: [],
        baseline: true,
      };
    }
  }
  const dependencyFiles = [...new Set(plan.dependencyChanges.map((item) => item.file))];
  const lockfilesChanged = plan.dependencyChanges.filter((item) => item.kind === "lockfile").map((item) => item.file);
  const manifestsChanged = plan.dependencyChanges.filter((item) => item.kind === "manifest").map((item) => item.file);
  return {
    repo: plan.repo,
    pr: plan.pr,
    headRefOid: plan.headRefOid,
    requiredSurfaces: [...requiredIds],
    evidenceRequiredSurfaces: evidenceRequired.map((item) => item.id),
    baselineSurfaces: plan.securityReview.depth === "skip" ? [] : [...SECURITY_BASELINES],
    matched,
    requiredProbes: (plan.requiredProbes || []).filter((id) => SECURITY_PROBES.has(id)),
    probeEvidence: Object.fromEntries(
      Object.entries(plan.probeEvidence || {}).filter(([id]) => SECURITY_PROBES.has(id)),
    ),
    securityReviewDepth: plan.securityReview.depth,
    lockfilesChanged,
    manifestsChanged,
    requireDepsAudit: dependencyFiles.length > 0,
    packageManager: packageManager(dependencyFiles),
    requireAgenticSkillsTop10: plan.securityReview.requiredDomains.includes("agentic_skills_supply_chain"),
    requireAiAgentSecurity: plan.securityReview.requiredDomains.some((id) => id === "ai_agent_mcp" || id === "agentic_skills_supply_chain"),
    removedControlLeads: plan.removedControlLeads,
    workflowPermissionChanges: plan.workflowPermissionChanges,
    renamedFiles: plan.renamedFiles,
    uncertainty: plan.uncertainty,
    complete: plan.complete,
    reviewPlan: plan,
    instructions: [
      "Cover every requiredSurfaces row. Baseline rows may be n/a only with concrete evidence that the boundary is untouched.",
      "Prioritize high- and medium-confidence evidence surfaces; low-confidence signals remain residual leads.",
      "Prove removed controls and broadened workflow permissions preserve the original invariant.",
      "Load ai-agent-security for AI/agent/MCP surfaces and Agentic Skills Top 10 for skill or MCP installation changes.",
      "Run the package-manager audit when manifests or lockfiles changed.",
      "Emit probe evidence for every requiredProbes id and verify it with `scripts/verify-probe-coverage.mjs` before claiming the security axis complete.",
    ],
  };
}

function matchingDetailed(plan, ids) {
  return plan.bugLenses.filter((item) => item.required && ids.includes(item.id));
}

export function projectBugScope(plan) {
  const detailed = plan.bugLenses.filter((item) => item.required);
  const skip = plan.bugReview.depth === "skip";
  const requiredLenses = skip ? [] : [...BUG_BASELINES, ...detailed.map((item) => item.id)];
  const lensEvidence = Object.fromEntries(detailed.map((item) => [item.id, {
    confidence: item.confidence,
    score: item.score,
    files: item.files,
    reasons: item.reasons,
    excerpts: item.excerpts,
  }]));
  if (!skip) {
    const groups = {
      silent_failures: matchingDetailed(plan, ["error_propagation", "retry_idempotency", "network_cancellation"]),
      resource_leaks: matchingDetailed(plan, ["resource_lifecycle", "network_cancellation", "filesystem_atomicity"]),
      edge_cases: matchingDetailed(plan, ["boundary_conditions", "concurrency_races", "state_consistency", "time_clocks", "ui_async_state", "parsing_serialization", "api_compatibility"]),
    };
    for (const id of BUG_BASELINES) {
      lensEvidence[id] = {
        confidence: "baseline",
        score: 0,
        files: [...new Set(groups[id].flatMap((item) => item.files))],
        reasons: groups[id].length
          ? [`baseline umbrella for detailed lenses: ${groups[id].map((item) => item.id).join(", ")}`]
          : ["baseline complementary review obligation for logic-bearing diffs"],
        excerpts: groups[id].flatMap((item) => item.excerpts).slice(0, 8),
        baseline: true,
      };
    }
  }
  return {
    repo: plan.repo,
    pr: plan.pr,
    headRefOid: plan.headRefOid,
    fileCount: plan.fileCount,
    logicFileCount: plan.logicFiles.length,
    logicFilesSample: plan.logicFiles.slice(0, 30),
    codeChanged: plan.logicFiles.length > 0,
    skipDeepBugReview: skip,
    bugReviewDepth: plan.bugReview.depth,
    requiredLenses,
    evidenceRequiredLenses: detailed.map((item) => item.id),
    baselineLenses: skip ? [] : [...BUG_BASELINES],
    lensEvidence,
    requiredProbes: (plan.requiredProbes || []).filter((id) => BUG_PROBES.has(id)),
    probeEvidence: Object.fromEntries(
      Object.entries(plan.probeEvidence || {}).filter(([id]) => BUG_PROBES.has(id)),
    ),
    requireBugbot: "when_available",
    deepMultiAgentDefault: false,
    uncertainty: plan.uncertainty,
    complete: plan.complete,
    reviewPlan: plan,
    instructions: [
      "Always cover silent_failures, resource_leaks, and edge_cases when the bug axis is not skipped.",
      "Also run every high- and medium-confidence detailed lens in one structured pass.",
      "Baseline means screen the umbrella lenses without pretending every detailed domain is touched.",
      "Bugbot is additive when available; a clean external result does not cancel required lenses.",
      "Never auto-launch adversarial or deep multi-agent review unless the user explicitly requested it.",
      "Emit probe evidence for every requiredProbes id and verify it with `scripts/verify-probe-coverage.mjs` before claiming the bug axis complete.",
    ],
  };
}
