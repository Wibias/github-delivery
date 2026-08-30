import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { mutationExecutionContextFromCheckpoint } from "../../scripts/lib/mutation-checkpoint.mjs";

const DELIVERY_CONTROLLER = fileURLToPath(
  new URL("../../scripts/delivery-controller.mjs", import.meta.url),
);

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

function createCheckpoint() {
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: "acme/widgets",
    startPhase: "OPEN_PR",
    graph: { OPEN_PR: ["DONE"], DONE: [] },
  });
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-routed-intent-"));
  const checkpoint = join(directory, "controller.json");
  writeDeliveryWorkflowCheckpoint(checkpoint, controller.snapshot());
  return { directory, checkpoint };
}

test("create-pr-for-issue automatically binds routed create_pr intent to the exact operation", () => {
  const { directory, checkpoint } = createCheckpoint();
  try {
    const request = createPrRequest();
    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({ path: checkpoint, request }),
      {
        trustedWorkflowIntent: true,
        trustedExactTextConfirmation: false,
      },
    );
    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({ path: checkpoint, request }),
      {
        trustedWorkflowIntent: true,
        trustedExactTextConfirmation: false,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("routed create_pr intent cannot be rebound to a changed mutation payload", () => {
  const { directory, checkpoint } = createCheckpoint();
  try {
    mutationExecutionContextFromCheckpoint({
      path: checkpoint,
      request: createPrRequest(),
    });
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: createPrRequest({ title: "Different effect" }),
      }),
      /mutation_workflow_intent_operation_mismatch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("caller-controlled explicitInstruction remains non-authoritative without controller context", () => {
  assert.deepEqual(
    mutationExecutionContextFromCheckpoint({
      path: null,
      request: createPrRequest({ explicitInstruction: true }),
    }),
    {
      trustedWorkflowIntent: false,
      trustedExactTextConfirmation: false,
    },
  );
});

test("Protection Off rejects model-callable manual workflow-intent authorization", () => {
  const { directory, checkpoint } = createCheckpoint();
  const requestPath = join(directory, "request.json");
  try {
    writeFileSync(requestPath, `${JSON.stringify(createPrRequest(), null, 2)}\n`, "utf8");
    const result = spawnSync(
      process.execPath,
      [
        DELIVERY_CONTROLLER,
        "authorize-mutation",
        checkpoint,
        "--request",
        requestPath,
        "--workflow-intent",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_DELIVERY_AUTHORITY_MODE: "off",
        },
      },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /mutation_workflow_intent_is_controller_owned/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
