#!/usr/bin/env node
import { projectSecurityScope } from "./lib/review-scope-compat.mjs";
import { collectPrReviewInput, planReviewScope } from "./lib/review-scope.mjs";

try {
  if (process.argv[2] === "--self-test") {
    const plan = planReviewScope({ files: [{ path: "src/api/admin.ts", patch: "-requireAdmin(user)\n+destroy(user)" }] });
    const output = projectSecurityScope(plan);
    if (!output.requiredSurfaces.includes("authz") || !output.baselineSurfaces.includes("injection")) {
      throw new Error("self-test failed");
    }
    process.stdout.write(JSON.stringify({ ok: true, depth: output.securityReviewDepth }, null, 2) + "\n");
  } else {
    const [repo, raw] = process.argv.slice(2);
    const pr = Number(raw);
    if (!repo?.includes("/") || !Number.isInteger(pr) || pr <= 0) throw new Error("Usage: node scripts/security-scope.mjs OWNER/REPO PR_NUMBER | --self-test");
    const plan = planReviewScope(collectPrReviewInput(repo, pr));
    process.stdout.write(JSON.stringify(projectSecurityScope(plan), null, 2) + "\n");
  }
} catch (error) {
  console.error(String(error?.message || error));
  process.exit(2);
}
