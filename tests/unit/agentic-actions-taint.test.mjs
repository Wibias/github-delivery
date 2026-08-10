import assert from "node:assert/strict";
import test from "node:test";

import { planReviewScope } from "../../scripts/lib/review-scope.mjs";
import { projectSecurityScope } from "../../scripts/lib/review-scope-compat.mjs";

test("agentic GitHub Actions input-to-agent flow requires the taint probe", () => {
  const plan = planReviewScope({
    repo: "owner/repo",
    pr: 42,
    headRefOid: "head",
    files: [
      {
        path: ".github/workflows/ai-review.yml",
        status: "modified",
        additions: 6,
        deletions: 0,
        patch: [
          "+on: pull_request_target",
          "+permissions:",
          "+  pull-requests: write",
          "+steps:",
          "+  - run: echo \"${{ github.event.pull_request.body }}\" > /tmp/prompt",
          "+  - uses: anthropics/claude-code-action@v1",
        ].join("\n"),
      },
    ],
  });

  assert.ok(plan.requiredProbes.includes("agentic-actions-taint"));
  const security = projectSecurityScope(plan);
  assert.ok(security.requiredProbes.includes("agentic-actions-taint"));
  assert.deepEqual(security.probeEvidence["agentic-actions-taint"].files, [".github/workflows/ai-review.yml"]);
});

test("ordinary non-agent workflow does not trigger the agentic taint probe", () => {
  const plan = planReviewScope({
    repo: "owner/repo",
    pr: 43,
    headRefOid: "head",
    files: [
      {
        path: ".github/workflows/lint.yml",
        status: "modified",
        additions: 2,
        deletions: 0,
        patch: "+steps:\n+  - run: npm run lint",
      },
    ],
  });

  assert.equal(plan.requiredProbes.includes("agentic-actions-taint"), false);
});
