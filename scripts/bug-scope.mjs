#!/usr/bin/env node
import { collectPrReviewInput, planReviewScope } from "./lib/review-scope.mjs";

function bugOutput(plan) {
  const required = plan.bugLenses.filter((item) => item.required);
  return {
    repo: plan.repo,
    pr: plan.pr,
    headRefOid: plan.headRefOid,
    fileCount: plan.fileCount,
    logicFileCount: plan.logicFiles.length,
    logicFilesSample: plan.logicFiles.slice(0, 30),
    codeChanged: plan.logicFiles.length > 0,
    skipDeepBugReview: plan.bugReview.depth === "skip",
    bugReviewDepth: plan.bugReview.depth,
    requiredLenses: required.map((item) => item.id),
    lensEvidence: Object.fromEntries(required.map((item) => [item.id, {
      confidence: item.confidence,
      score: item.score,
      files: item.files,
      reasons: item.reasons,
      excerpts: item.excerpts,
    }])),
    requireBugbot: "when_available",
    deepMultiAgentDefault: false,
    uncertainty: plan.uncertainty,
    complete: plan.complete,
    reviewPlan: plan,
    instructions: [
      "Run every high- and medium-confidence lens in one structured pass.",
      "Baseline means screen error propagation and boundaries without pretending every domain is touched.",
      "Bugbot is additive when available; a clean external tool result does not cancel evidence-required lenses.",
      "Never auto-launch adversarial or deep multi-agent review unless the user explicitly requested it.",
    ],
  };
}

try {
  if (process.argv[2] === "--self-test") {
    const plan = planReviewScope({ files: [{ path: "src/worker.ts", patch: "+new Worker(url)\n+worker.terminate()" }] });
    if (!plan.bugReview.requiredLenses.includes("resource_lifecycle")) throw new Error("self-test failed");
    process.stdout.write(JSON.stringify({ ok: true, depth: plan.bugReview.depth }, null, 2) + "\n");
  } else {
    const [repo, raw] = process.argv.slice(2);
    const pr = Number(raw);
    if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) throw new Error("Usage: node scripts/bug-scope.mjs OWNER/REPO PR_NUMBER | --self-test");
    process.stdout.write(JSON.stringify(bugOutput(planReviewScope(collectPrReviewInput(repo, pr))), null, 2) + "\n");
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
