import assert from "node:assert/strict";
import test from "node:test";

import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import { validateWorkflowMutationMode } from "../../scripts/lib/workflow-mode.mjs";

test("routes competing PR analysis read-only", () => {
  const route = routeShippingGithubPrompt("triage the competing PRs in this repo");
  assert.equal(route.workflow, "references/consolidate-prs.md");
  assert.equal(route.mutationMode, "read-only");
  assert.deepEqual(route.explicitActions, []);
});

test("issue research keeps precedence when PR duplicates are only research evidence", () => {
  const route = routeShippingGithubPrompt(
    "Research issues #88 and #91 on the latest development branch — still real bugs? already fixed? open PRs? duplicates? priority; comment on each issue",
  );
  assert.equal(route.workflow, "references/research-issue.md");
  assert.equal(route.mutationMode, "review");
  assert.deepEqual(route.explicitActions, []);
});

test("consolidation route never grants maintainer mutation mode", () => {
  assert.equal(validateWorkflowMutationMode({ workflow: "references/consolidate-prs.md", mutationMode: "read-only" }).valid, true);
  assert.equal(validateWorkflowMutationMode({ workflow: "references/consolidate-prs.md", mutationMode: "maintainer" }).valid, false);
});

test("consolidation controller terminates after analysis/report", () => {
  const profile = resolveDeliveryWorkflowProfile("consolidate-prs");
  assert.equal(profile.mutation, "read-only");
  assert.deepEqual(profile.graph.ANALYZE, ["REPORT"]);
  assert.deepEqual(profile.graph.REPORT, ["DONE"]);
});
