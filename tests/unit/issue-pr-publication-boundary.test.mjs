import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCreatePrPublicationPlan } from "../../scripts/lib/create-pr-publication-plan.mjs";
import { createPrPublicationPlanLock } from "../../scripts/lib/create-pr-publication-state.mjs";
import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import { lockCreatePrPublicationPlanCheckpoint } from "../../scripts/lib/mutation-checkpoint.mjs";
import { executionContractForWorkflow } from "../../scripts/lib/workflow-execution-contract.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function plan(path) {
  return buildCreatePrPublicationPlan({
    repo: "acme/widgets",
    remote: "origin",
    branch: "feat/253-widgets",
    base: "dev",
    expectedRemoteTip: "absent",
    originalLocalTip: HEAD,
    newTip: HEAD,
    title: "Fix widgets",
    body: "Refs #253\n",
    idempotencyKey: "issue-253-create-pr",
    checkpoint: path,
  });
}

test("issue create-PR workflow can terminate after verified publication when the user requested open-only", () => {
  const profile = resolveDeliveryWorkflowProfile("create-pr-for-issue");
  assert.ok(profile.graph.OPEN_PR.includes("DONE"));
});

test("issue create-PR workflow exposes the canonical publication planner", () => {
  const contract = executionContractForWorkflow("create-pr-for-issue");
  assert.equal(contract.workflowPlan.publication.planner, "scripts/create-pr-publication-plan.mjs");
  assert.equal(contract.workflowPlan.publication.openOnlyTerminalPhase, "OPEN_PR");
  assert.equal(contract.workflowPlan.sourceDiscovery, "diagnostic-only-on-helper-failure");
});

test("issue create-PR checkpoints can lock the same validated publication plan as local work", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-issue-plan-"));
  const path = join(directory, "checkpoint.json");
  try {
    const profile = resolveDeliveryWorkflowProfile("create-pr-for-issue");
    const controller = createDeliveryWorkflowController({
      workflow: "create-pr-for-issue",
      repo: "acme/widgets",
      baseSha: BASE,
      headSha: HEAD,
      graph: profile.graph,
      startPhase: "PREOPEN_GATE",
    });
    writeDeliveryWorkflowCheckpoint(path, controller.snapshot());

    const lock = lockCreatePrPublicationPlanCheckpoint({ path, plan: plan(path) });
    assert.equal(lock.headSha, HEAD);
    const snapshot = readDeliveryWorkflowCheckpoint(path);
    assert.equal(snapshot.publicationPlan.headSha, HEAD);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("issue open-only completion still requires successful locked publication receipts", () => {
  const profile = resolveDeliveryWorkflowProfile("create-pr-for-issue");
  const publicationPlan = createPrPublicationPlanLock(plan("checkpoint.json"), { headSha: HEAD });
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: profile.graph,
    startPhase: "OPEN_PR",
    publicationPlan,
    publicationReceipts: {},
  });

  assert.throws(() => controller.transition("DONE"), /create_pr_publication_.*missing/);
});
