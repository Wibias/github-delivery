import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import { executionContractForWorkflow } from "../../scripts/lib/workflow-execution-contract.mjs";
import { mutationExecutionContextFromCheckpoint } from "../../scripts/lib/mutation-checkpoint.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);

function readyGate() {
  return {
    decision: "ready",
    repo: "acme/widgets",
    baseRef: "main",
    headRef: "feature/widgets",
    baseRefOid: BASE,
    headRefOid: HEAD,
    diffIdentity: `sha256:${"d".repeat(64)}`,
    fileCount: 2,
  };
}

function controller() {
  const profile = resolveDeliveryWorkflowProfile("create-pr-from-local-work");
  return createDeliveryWorkflowController({
    workflow: profile.workflow,
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: profile.graph,
    startPhase: "PREOPEN_GATE",
  });
}

function legacyReadyController() {
  const current = controller();
  current.recordPreOpenGate(readyGate());
  current.recordHygienePass("no-comments", { status: "done" });
  current.recordHygienePass("simplify", { status: "done" });
  current.transition("OPEN_PR");
  return current;
}

test("raw controller API cannot mint pre-open hygiene completion receipts", () => {
  const current = controller();
  assert.equal(typeof current.recordHygienePass, "undefined");
});

test("local PR workflow cannot leave OPEN_PR before canonical publication receipts exist", () => {
  const current = legacyReadyController();
  assert.throws(
    () => current.transition("REVIEW_FEEDBACK"),
    /create_pr_publication_incomplete/,
  );
});

test("mutation checkpoint rejects local publication requests before the canonical plan is locked", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-publication-plan-"));
  const checkpoint = join(directory, "controller.json");
  try {
    const current = legacyReadyController();
    writeDeliveryWorkflowCheckpoint(checkpoint, current.snapshot());
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: {
          schemaVersion: 1,
          action: "push_code",
          mutationMode: "maintainer",
          repo: "acme/widgets",
          remote: "origin",
          branch: "feature/widgets",
          expectedRemoteTip: "absent",
          originalLocalTip: HEAD,
          newTip: HEAD,
          forceWithLease: true,
        },
      }),
      /create_pr_publication_plan_missing/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local PR execution contract names executable base, hygiene-scope, and completion boundaries", () => {
  const plan = executionContractForWorkflow("create-pr-from-local-work").workflowPlan;
  assert.equal(plan.preOpen.baseAuthority, "checkpoint-locked-remote");
  assert.deepEqual(plan.hygiene, {
    commentScope: "diff-added-lines",
    resultValidation: "structured-final-only",
    receiptAuthority: "pre-open-gate",
  });
  assert.equal(plan.publication.completion, "broker-receipts");
});
