import assert from "node:assert/strict";
import test from "node:test";

import { briefText } from "../../scripts/review-brief.mjs";
import { planReviewDepthExecution } from "../../scripts/lib/review-depth-execution.mjs";

test("review brief renders the operational stages selected by scope depth", () => {
  const executionPlan = planReviewDepthExecution({
    bugScope: { bugReviewDepth: "deep" },
    securityScope: { securityReviewDepth: "full" },
  });
  const text = briefText({
    meta: { repo: "acme/widget", pr: 7 },
    plan: {
      fileCount: 0,
      logicFiles: [],
      headRefOid: "head",
      requiredProbes: [],
      dependencyChanges: [],
      removedControlLeads: [],
      uncertainty: [],
    },
    files: [],
    bugScope: { requiredLenses: [] },
    securityScope: { requiredSurfaces: [] },
    executionPlan,
    maxHunkLines: 24,
  });

  assert.match(text, /Review depth execution/);
  assert.match(text, /Bug depth: deep/);
  assert.match(text, /bug-finder-challenger-arbiter/);
  assert.match(text, /Security depth: full/);
  assert.match(text, /security-attack-path-chain-analysis/);
});
