#!/usr/bin/env node
import { collectPrReviewInput, planReviewScope } from "./lib/review-scope.mjs";

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

function securityOutput(plan) {
  const required = plan.domains.filter((item) => item.category === "security" && item.required);
  const matched = Object.fromEntries(required.map((item) => [item.id, {
    why: item.reasons.join("; "),
    files: item.files,
    confidence: item.confidence,
    score: item.score,
    excerpts: item.excerpts,
  }]));
  const dependencyFiles = [...new Set(plan.dependencyChanges.map((item) => item.file))];
  const lockfilesChanged = plan.dependencyChanges.filter((item) => item.kind === "lockfile").map((item) => item.file);
  const manifestsChanged = plan.dependencyChanges.filter((item) => item.kind === "manifest").map((item) => item.file);
  return {
    repo: plan.repo,
    pr: plan.pr,
    headRefOid: plan.headRefOid,
    requiredSurfaces: required.map((item) => item.id),
    matched,
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
      "Cover every high- and medium-confidence required surface. Treat low-confidence signals as residual leads, not findings.",
      "Prove removed controls and broadened workflow permissions preserve the original invariant.",
      "Load ai-agent-security for AI/agent/MCP surfaces and Agentic Skills Top 10 for skill or MCP installation changes.",
      "Run the package-manager audit when manifests or lockfiles changed.",
    ],
  };
}

try {
  if (process.argv[2] === "--self-test") {
    const plan = planReviewScope({ files: [{ path: "src/api/admin.ts", patch: "-requireAdmin(user)\n+destroy(user)" }] });
    if (!plan.securityReview.requiredDomains.includes("authz")) throw new Error("self-test failed");
    process.stdout.write(JSON.stringify({ ok: true, depth: plan.securityReview.depth }, null, 2) + "\n");
  } else {
    const [repo, raw] = process.argv.slice(2);
    const pr = Number(raw);
    if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) throw new Error("Usage: node scripts/security-scope.mjs OWNER/REPO PR_NUMBER | --self-test");
    process.stdout.write(JSON.stringify(securityOutput(planReviewScope(collectPrReviewInput(repo, pr))), null, 2) + "\n");
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
