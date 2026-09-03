import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCreatePrPublicationPlan } from "../../scripts/lib/create-pr-publication-plan.mjs";
import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import { executionContractForWorkflow } from "../../scripts/lib/workflow-execution-contract.mjs";
import {
  lockCreatePrPublicationPlanCheckpoint,
  mutationExecutionContextFromCheckpoint,
  reconcileMutationCheckpoint,
} from "../../scripts/lib/mutation-checkpoint.mjs";
import { mutationOperationKey } from "../../scripts/lib/mutation-document-execution.mjs";

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

function hygienePasses() {
  return {
    noComments: { status: "done", headSha: HEAD, recordedAt: 1 },
    simplify: { status: "done", headSha: HEAD, recordedAt: 1 },
  };
}

function controller({ hygiene = true } = {}) {
  const profile = resolveDeliveryWorkflowProfile("create-pr-from-local-work");
  return createDeliveryWorkflowController({
    workflow: profile.workflow,
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: profile.graph,
    startPhase: "PREOPEN_GATE",
    ...(hygiene ? { hygienePasses: hygienePasses() } : {}),
  });
}

function readyController() {
  const current = controller();
  current.recordPreOpenGate(readyGate());
  current.transition("OPEN_PR");
  return current;
}

function publicationPlan(checkpoint) {
  return buildCreatePrPublicationPlan({
    repo: "acme/widgets",
    remote: "origin",
    branch: "feature/widgets",
    base: "main",
    expectedRemoteTip: "absent",
    originalLocalTip: HEAD,
    newTip: HEAD,
    title: "Fix widgets",
    body: "Body",
    idempotencyKey: "create-pr-feature-widgets",
    checkpoint,
  });
}

test("raw controller API cannot mint pre-open hygiene completion receipts", () => {
  const current = controller({ hygiene: false });
  assert.equal(typeof current.recordHygienePass, "undefined");
});

test("local PR workflow cannot leave OPEN_PR before canonical publication receipts exist", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-publication-incomplete-"));
  const checkpoint = join(directory, "controller.json");
  try {
    const current = readyController();
    writeDeliveryWorkflowCheckpoint(checkpoint, current.snapshot());
    lockCreatePrPublicationPlanCheckpoint({ path: checkpoint, plan: publicationPlan(checkpoint) });
    const locked = readDeliveryWorkflowCheckpoint(checkpoint);
    const resumed = createDeliveryWorkflowController({
      snapshot: locked,
      graph: locked.graph,
    });
    assert.throws(
      () => resumed.transition("REVIEW_FEEDBACK"),
      /create_pr_publication_incomplete/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mutation checkpoint rejects local publication requests before the canonical plan is locked", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-publication-plan-"));
  const checkpoint = join(directory, "controller.json");
  try {
    const current = readyController();
    writeDeliveryWorkflowCheckpoint(checkpoint, current.snapshot());
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: publicationPlan(checkpoint).requests[0],
      }),
      /create_pr_publication_plan_missing/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("only exact locked requests can complete local PR publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-publication-receipts-"));
  const checkpoint = join(directory, "controller.json");
  try {
    const current = readyController();
    writeDeliveryWorkflowCheckpoint(checkpoint, current.snapshot());
    const plan = publicationPlan(checkpoint);
    lockCreatePrPublicationPlanCheckpoint({ path: checkpoint, plan });
    lockCreatePrPublicationPlanCheckpoint({ path: checkpoint, plan });

    const push = plan.requests[0];
    const create = plan.requests[1];
    assert.doesNotThrow(() => mutationExecutionContextFromCheckpoint({ path: checkpoint, request: push }));
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: { ...push, branch: "other" },
      }),
      /create_pr_publication_plan_mismatch/,
    );

    reconcileMutationCheckpoint({
      path: checkpoint,
      output: {
        action: "push_code",
        request: push,
        status: "succeeded",
        operationKey: mutationOperationKey(push),
      },
    });
    let snapshot = readDeliveryWorkflowCheckpoint(checkpoint);
    assert.equal(snapshot.publicationReceipts.push_code.status, "succeeded");
    assert.equal(snapshot.publicationReceipts.create_pr, undefined);
    let resumed = createDeliveryWorkflowController({ snapshot, graph: snapshot.graph });
    assert.throws(() => resumed.transition("REVIEW_FEEDBACK"), /create_pr_publication_incomplete/);

    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({ path: checkpoint, request: create }),
      { trustedWorkflowIntent: true, trustedExactTextConfirmation: false },
    );
    reconcileMutationCheckpoint({
      path: checkpoint,
      output: {
        action: "create_pr",
        request: create,
        status: "succeeded",
        operationKey: mutationOperationKey(create),
      },
    });
    snapshot = readDeliveryWorkflowCheckpoint(checkpoint);
    assert.equal(snapshot.publicationReceipts.create_pr.status, "succeeded");
    resumed = createDeliveryWorkflowController({ snapshot, graph: snapshot.graph });
    assert.equal(resumed.transition("REVIEW_FEEDBACK").phase, "REVIEW_FEEDBACK");
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
