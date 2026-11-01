import assert from "node:assert/strict";
import test from "node:test";

import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";

test("routes hyphenated full-review requests without requiring a numbered PR", () => {
  const route = routeShippingGithubPrompt(
    "Full-review this PR. Require target-base versus candidate cost evidence.",
  );

  assert.deepEqual(route, {
    skill: "github-delivery",
    workflow: "references/full-review-pr.md",
    mutationMode: "read-only",
    explicitActions: [],
  });
});
