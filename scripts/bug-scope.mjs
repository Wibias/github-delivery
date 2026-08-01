#!/usr/bin/env node
import { projectBugScope } from "./lib/review-scope-compat.mjs";
import { collectPrReviewInput, planReviewScope } from "./lib/review-scope.mjs";

try {
  if (process.argv[2] === "--self-test") {
    const plan = planReviewScope({ files: [{ path: "src/worker.ts", patch: "+new Worker(url)\n+worker.terminate()" }] });
    const output = projectBugScope(plan);
    if (!output.requiredLenses.includes("resource_lifecycle") || !output.requiredLenses.includes("resource_leaks")) {
      throw new Error("self-test failed");
    }
    process.stdout.write(JSON.stringify({ ok: true, depth: output.bugReviewDepth }, null, 2) + "\n");
  } else {
    const [repo, raw] = process.argv.slice(2);
    const pr = Number(raw);
    if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) throw new Error("Usage: node scripts/bug-scope.mjs OWNER/REPO PR_NUMBER | --self-test");
    const plan = planReviewScope(collectPrReviewInput(repo, pr));
    process.stdout.write(JSON.stringify(projectBugScope(plan), null, 2) + "\n");
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
