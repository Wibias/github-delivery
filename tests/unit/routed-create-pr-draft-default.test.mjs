import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildCreatePrPublicationPlan } from "../../scripts/lib/create-pr-publication-plan.mjs";
import {
  createDeliveryWorkflowController,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import {
  lockCreatePrPublicationPlanCheckpoint,
  mutationExecutionContextFromCheckpoint,
} from "../../scripts/lib/mutation-checkpoint.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const GRAPH = {
  PREOPEN_GATE: ["OPEN_PR"],
  OPEN_PR: [],
};

function readyGate() {
  return {
    decision: "ready",
    repo: "acme/widgets",
    baseRef: "dev",
    headRef: "task",
    baseSha: BASE,
    headSha: HEAD,
    diffIdentity: `sha256:${"d".repeat(64)}`,
    fileCount: 2,
  };
}

function request(draft) {
  return {
    schemaVersion: 1,
    action: "create_pr",
    mutationMode: "maintainer",
    repo: "acme/widgets",
    base: "dev",
    head: "task",
    title: "Fix widgets",
    body: "Body",
    draft,
    idempotencyKey: "routed-create-pr-draft-default",
  };
}

function plan(path) {
  return buildCreatePrPublicationPlan({
    repo: "acme/widgets",
    remote: "origin",
    branch: "task",
    base: "dev",
    expectedRemoteTip: "absent",
    originalLocalTip: HEAD,
    newTip: HEAD,
    title: "Fix widgets",
    body: "Body",
    idempotencyKey: "routed-create-pr-draft-default",
    checkpoint: path,
  });
}

function checkpoint(path) {
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-from-local-work",
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: GRAPH,
    startPhase: "PREOPEN_GATE",
    hygienePasses: {
      noComments: { status: "done", headSha: HEAD, recordedAt: 1 },
      simplify: { status: "done", headSha: HEAD, recordedAt: 1 },
    },
  });
  controller.recordPreOpenGate(readyGate());
  controller.transition("OPEN_PR");
  writeDeliveryWorkflowCheckpoint(path, controller.snapshot());
  lockCreatePrPublicationPlanCheckpoint({ path, plan: plan(path) });
}

test("routed create-PR publication rejects a non-draft create_pr payload", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-routed-draft-"));
  const path = join(directory, "checkpoint.json");
  try {
    checkpoint(path);
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({ path, request: request(false) }),
      /routed_create_pr_requires_draft/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("routed create-PR publication still binds workflow intent for the exact draft plan", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-routed-draft-ok-"));
  const path = join(directory, "checkpoint.json");
  try {
    checkpoint(path);
    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({ path, request: request(true) }),
      {
        trustedWorkflowIntent: true,
        trustedExactTextConfirmation: false,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
