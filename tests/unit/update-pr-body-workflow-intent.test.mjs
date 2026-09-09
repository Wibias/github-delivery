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
import { executeMutationDocument } from "../../scripts/lib/mutation-document-execution.mjs";
import { authorizeMutation } from "../../scripts/lib/mutation-policy.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const OTHER_HEAD = "c".repeat(40);

function updatePrBodyRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "update_pr_body",
    mutationMode: "maintainer",
    repo: "acme/widgets",
    pr: 95,
    expectedHead: HEAD,
    body: "## Summary\n\nFinal five-file scope.",
    ...overrides,
  };
}

function createCheckpoint({ phase = "FINAL_GATE", pr = 95, headSha = HEAD } = {}) {
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: "acme/widgets",
    pr,
    baseSha: BASE,
    headSha,
    startPhase: phase,
    graph: { [phase]: ["DONE"], DONE: [] },
  });
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-update-body-intent-"));
  const checkpoint = join(directory, "controller.json");
  writeDeliveryWorkflowCheckpoint(checkpoint, controller.snapshot());
  return { directory, checkpoint };
}

test("final-gate PR-body reconciliation receives controller-owned intent", () => {
  const { directory, checkpoint } = createCheckpoint();
  try {
    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: updatePrBodyRequest(),
      }),
      {
        trustedWorkflowIntent: true,
        trustedExactTextConfirmation: false,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("final-gate PR-body reconciliation is bound to the controller head", () => {
  const { directory, checkpoint } = createCheckpoint();
  try {
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: updatePrBodyRequest({ expectedHead: OTHER_HEAD }),
      }),
      /mutation_workflow_intent_head_mismatch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("final-gate PR-body reconciliation is bound to the controller PR", () => {
  const { directory, checkpoint } = createCheckpoint();
  try {
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: updatePrBodyRequest({ pr: 96 }),
      }),
      /mutation_workflow_intent_pr_mismatch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a routed PR-body reconciliation cannot be rebound to changed body text", () => {
  const { directory, checkpoint } = createCheckpoint();
  try {
    assert.equal(
      mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: updatePrBodyRequest(),
      }).trustedWorkflowIntent,
      true,
    );
    assert.throws(
      () => mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: updatePrBodyRequest({ body: "Different body" }),
      }),
      /mutation_workflow_intent_operation_mismatch/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("earlier create-PR phases do not auto-authorize PR-body updates", () => {
  const { directory, checkpoint } = createCheckpoint({ phase: "REVIEW_FEEDBACK" });
  try {
    assert.deepEqual(
      mutationExecutionContextFromCheckpoint({
        path: checkpoint,
        request: updatePrBodyRequest(),
      }),
      {
        trustedWorkflowIntent: false,
        trustedExactTextConfirmation: false,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Protection Off executes the exact final-gate PR-body reconciliation without Authority-host authorization", () => {
  const { directory, checkpoint } = createCheckpoint();
  let authorityCalls = 0;
  let executionCalls = 0;
  try {
    const request = updatePrBodyRequest();
    const result = executeMutationDocument({
      document: request,
      execute: true,
      env: {
        ...process.env,
        GITHUB_DELIVERY_AUTHORITY_MODE: "off",
      },
      dependencies: {
        executionContextForRequest(currentRequest) {
          return mutationExecutionContextFromCheckpoint({
            path: checkpoint,
            request: currentRequest,
          });
        },
        authorizeBatchSync() {
          authorityCalls += 1;
          throw new Error("Authority host must not be called in Protection Off");
        },
        executeMutationWithAuthority(options) {
          executionCalls += 1;
          assert.equal(options.trustedWorkflowIntent, true);
          return {
            action: options.request.action,
            request: options.request,
            status: "succeeded",
            authority: {
              verified: false,
              provenance: "authority_disabled_by_user",
            },
          };
        },
      },
    });
    assert.equal(authorityCalls, 0);
    assert.equal(executionCalls, 1);
    assert.equal(result.status, "succeeded");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("standalone maintainer PR-body updates still require explicit instruction", () => {
  const denied = authorizeMutation({
    mode: "maintainer",
    action: "update_pr_body",
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "explicit_instruction_required");
  assert.deepEqual(
    mutationExecutionContextFromCheckpoint({
      path: null,
      request: updatePrBodyRequest({ explicitInstruction: true }),
    }),
    {
      trustedWorkflowIntent: false,
      trustedExactTextConfirmation: false,
    },
  );
});
