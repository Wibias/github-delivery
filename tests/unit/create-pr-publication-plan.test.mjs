import assert from "node:assert/strict";
import test from "node:test";

import { buildCreatePrPublicationPlan } from "../../scripts/lib/create-pr-publication-plan.mjs";

const OLD = "a".repeat(40);
const HEAD = "b".repeat(40);

function input(overrides = {}) {
  return {
    repo: "acme/widgets",
    remote: "origin",
    branch: "feature/widgets",
    base: "dev",
    expectedRemoteTip: OLD,
    originalLocalTip: OLD,
    newTip: HEAD,
    title: "Fix widgets",
    body: "## Summary\n\nFix widget behavior.\n",
    idempotencyKey: "create-pr-feature-widgets",
    checkpoint: ".github-delivery/workflow.json",
    ...overrides,
  };
}

test("planner owns the canonical push and draft create_pr request shapes", () => {
  const plan = buildCreatePrPublicationPlan(input());
  assert.deepEqual(plan.requests, [
    {
      schemaVersion: 1,
      action: "push_code",
      mutationMode: "maintainer",
      repo: "acme/widgets",
      remote: "origin",
      branch: "feature/widgets",
      expectedRemoteTip: OLD,
      originalLocalTip: OLD,
      newTip: HEAD,
      forceWithLease: true,
    },
    {
      schemaVersion: 1,
      action: "create_pr",
      mutationMode: "maintainer",
      repo: "acme/widgets",
      base: "dev",
      head: "feature/widgets",
      title: "Fix widgets",
      body: "## Summary\n\nFix widget behavior.\n",
      idempotencyKey: "create-pr-feature-widgets",
      draft: true,
    },
  ]);
  assert.deepEqual(plan.execute, {
    entrypoint: "scripts/github-mutate.mjs",
    checkpoint: ".github-delivery/workflow.json",
  });
});

test("new remote branches use the broker's absent lease identity", () => {
  const plan = buildCreatePrPublicationPlan(input({ expectedRemoteTip: "absent" }));
  assert.equal(plan.requests[0].expectedRemoteTip, "absent");
});

test("planner rejects caller attempts to turn initial routed creation non-draft", () => {
  assert.throws(
    () => buildCreatePrPublicationPlan(input({ draft: false })),
    /create_pr_publication_plan_draft_only/,
  );
});
