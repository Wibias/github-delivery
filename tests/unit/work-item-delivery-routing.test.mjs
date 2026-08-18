import assert from "node:assert/strict";
import test from "node:test";

import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import { validateWorkflowMutationMode } from "../../scripts/lib/workflow-mode.mjs";

test("routes work-item status questions read-only", () => {
  const route = routeShippingGithubPrompt("what's left on ENG-42?");
  assert.equal(route.workflow, "references/work-item-delivery.md");
  assert.equal(route.mutationMode, "read-only");
  assert.deepEqual(route.explicitActions, []);
});

test("open-PR work-item requests bind publication writes without inventing merge authority", () => {
  const route = routeShippingGithubPrompt("work on ENG-42 and open a PR");
  assert.equal(route.workflow, "references/work-item-delivery.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.deepEqual(route.explicitActions, ["push_code", "create_pr"]);
  assert.equal(route.explicitActions.includes("merge_pr"), false);
});

test("implementation-only work-item requests do not silently grant publication writes", () => {
  const route = routeShippingGithubPrompt("implement ENG-42");
  assert.equal(route.workflow, "references/work-item-delivery.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.deepEqual(route.explicitActions, []);
});

test("explicit ship wording preserves publication and merge intent for delegated phases", () => {
  const route = routeShippingGithubPrompt("ship ENG-42");
  assert.equal(route.workflow, "references/work-item-delivery.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("create_pr"));
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("workflow modes allow read-only inspection and maintainer delivery only", () => {
  assert.equal(validateWorkflowMutationMode({ workflow: "references/work-item-delivery.md", mutationMode: "read-only" }).valid, true);
  assert.equal(validateWorkflowMutationMode({ workflow: "references/work-item-delivery.md", mutationMode: "maintainer" }).valid, true);
  assert.equal(validateWorkflowMutationMode({ workflow: "references/work-item-delivery.md", mutationMode: "autonomous" }).valid, false);
});

test("work-item delivery controller has explicit reconcile and report phases", () => {
  const profile = resolveDeliveryWorkflowProfile("work-item-delivery");
  assert.equal(profile.mutation, "profile-dependent");
  assert.deepEqual(profile.graph.RECONCILE, ["REPORT"]);
  assert.deepEqual(profile.graph.REPORT, ["DONE"]);
});
