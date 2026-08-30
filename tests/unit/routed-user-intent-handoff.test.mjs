import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { mutationExecutionContextFromCheckpoint } from "../../scripts/lib/mutation-checkpoint.mjs";

function createPrRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "create_pr",
    mutationMode: "maintainer",
    explicitInstruction: false,
    repo: "acme/widgets",
    base: "main",
    head: "fix/issue-95",
    title: "Fix issue 95",
    body: "Refs #95",
    idempotencyKey: "issue-95-pr",
    ...overrides,
  };
}

test("create-pr-for-issue binds routed create_pr intent to the exact operation", () => {
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: "acme/widgets",
    startPhase: "OPEN_PR",
    graph: { OPEN_PR: ["DONE"], DONE: [] },
  });
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-routed-intent-"));
  const checkpoint = join(directory, "controller.json");
  try {
    writeDeliveryWorkflowCheckpoint(checkpoint, controller.snapshot());
    const context = mutationExecutionContextFromCheckpoint({
      path: checkpoint,
      request: createPrRequest(),
      bindWorkflowIntent: true,
    });
    assert.deepEqual(context, {
      trustedWorkflowIntent: true,
      trustedExactTextConfirmation: false,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
