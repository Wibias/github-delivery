import assert from "node:assert/strict";
import test from "node:test";

import { planReviewScope } from "../../scripts/lib/review-scope.mjs";

test("review scope surfaces conditional visual evidence for UI changes", () => {
  const plan = planReviewScope({
    repo: "acme/widgets",
    pr: 42,
    headRefOid: "a".repeat(40),
    files: [{
      filename: "src/components/Card.tsx",
      status: "modified",
      patch: "@@ -1 +1 @@\n-return <div />;\n+return <button className=\"primary\">Go</button>;",
      additions: 1,
      deletions: 1,
    }],
  });

  assert.equal(plan.visualEvidence.required, true);
  assert.deepEqual(plan.visualEvidence.files, ["src/components/Card.tsx"]);
  assert.ok(plan.instructions.some((line) => line.includes("references/visual-evidence.md")));
});

test("review scope does not demand visual evidence for backend-only logic", () => {
  const plan = planReviewScope({
    repo: "acme/widgets",
    pr: 43,
    headRefOid: "b".repeat(40),
    files: [{
      filename: "src/server/token.ts",
      status: "modified",
      patch: "@@ -1 +1 @@\n-return oldToken;\n+return nextToken;",
      additions: 1,
      deletions: 1,
    }],
  });

  assert.equal(plan.visualEvidence.required, false);
  assert.equal(plan.instructions.some((line) => line.includes("references/visual-evidence.md")), false);
});
