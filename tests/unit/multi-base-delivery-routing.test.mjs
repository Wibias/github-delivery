import assert from "node:assert/strict";
import test from "node:test";

import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import { validateWorkflowMutationMode } from "../../scripts/lib/workflow-mode.mjs";

test("routes a backport request to multi-base delivery with publication authority only", () => {
  const route = routeShippingGithubPrompt("backport PR #42 to release/1.x");
  assert.equal(route.workflow, "references/multi-base-delivery.md");
  assert.equal(route.mutationMode, "maintainer");
  assert.deepEqual(route.explicitActions, ["push_code", "create_pr"]);
});

test("explicit merge wording adds merge authority for the port workflow", () => {
  const route = routeShippingGithubPrompt("backport PR #42 to release/1.x and merge it");
  assert.equal(route.workflow, "references/multi-base-delivery.md");
  assert.ok(route.explicitActions.includes("push_code"));
  assert.ok(route.explicitActions.includes("create_pr"));
  assert.ok(route.explicitActions.includes("merge_pr"));
});

test("a merge discussion does not accidentally authorize port merges", () => {
  const route = routeShippingGithubPrompt("backport PR #42 to release/1.x, but should we merge it?");
  assert.equal(route.workflow, "references/multi-base-delivery.md");
  assert.equal(route.explicitActions.includes("merge_pr"), false);
});

test("multi-base delivery is maintainer-only", () => {
  assert.equal(validateWorkflowMutationMode({ workflow: "references/multi-base-delivery.md", mutationMode: "maintainer" }).valid, true);
  assert.equal(validateWorkflowMutationMode({ workflow: "references/multi-base-delivery.md", mutationMode: "read-only" }).valid, false);
  assert.equal(validateWorkflowMutationMode({ workflow: "references/multi-base-delivery.md", mutationMode: "autonomous" }).valid, false);
});

test("multi-base controller verifies ports before the final gate", () => {
  const profile = resolveDeliveryWorkflowProfile("multi-base-delivery");
  assert.equal(profile.mutation, "maintainer");
  assert.deepEqual(profile.graph.PUBLISH, ["VERIFY_PORTS"]);
  assert.deepEqual(profile.graph.VERIFY_PORTS, ["FINAL_GATE", "DONE"]);
});
