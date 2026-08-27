import assert from "node:assert/strict";
import test from "node:test";

import { createDeliveryWorkflowController } from "../../scripts/lib/delivery-workflow-controller.mjs";
import {
  executeMutationDocument,
  mutationOperationKey,
} from "../../scripts/lib/mutation-document-execution.mjs";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const REPO = "Wibias/github-delivery";

function controller() {
  return createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: REPO,
    startPhase: "ROUTE",
    graph: { ROUTE: ["DONE"], DONE: [] },
    headSha: OLD,
  });
}

function pushRequest() {
  return {
    schemaVersion: 1,
    action: "push_code",
    mutationMode: "maintainer",
    explicitInstruction: true,
    repo: REPO,
    remote: "origin",
    branch: "fix/audit-controller-reconciliation",
    expectedRemoteTip: OLD,
    originalLocalTip: OLD,
    newTip: NEW,
    forceWithLease: false,
  };
}

test("controller advances head after a push reconciled from an uncertain write", () => {
  const state = controller();
  const result = state.reconcileMutationResult({
    action: "push_code",
    status: "reconciled_after_error",
    request: pushRequest(),
  });
  assert.equal(result.changed, true);
  assert.equal(result.headSha, NEW);
  assert.equal(state.snapshot().headSha, NEW);
  assert.equal(state.snapshot().stateGeneration, 1);
});

test("reconciled_after_error is completed for duplicate operations in the same document", () => {
  const request = pushRequest();
  let executions = 0;
  const output = executeMutationDocument({
    document: [request, request],
    execute: false,
    dependencies: {
      executeMutationWithAuthority({ request: current }) {
        executions += 1;
        return {
          action: current.action,
          request: current,
          status: "reconciled_after_error",
          executed: true,
          verification: current.newTip,
        };
      },
    },
  });
  assert.equal(executions, 1);
  assert.equal(output.results[0].status, "reconciled_after_error");
  assert.equal(output.results[1].status, "already_applied");
});

test("resume skip receipt keeps the original request so controller can recover newTip", () => {
  const request = pushRequest();
  const output = executeMutationDocument({
    document: request,
    execute: false,
    dependencies: {
      completedOperationKeys: [mutationOperationKey(request)],
      executeMutationWithAuthority() {
        throw new Error("completed mutation must not execute again");
      },
    },
  });
  assert.equal(output.status, "already_applied");
  assert.deepEqual(output.request, request);

  const state = controller();
  const reconciled = state.reconcileMutationResult(output);
  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.headSha, NEW);
});
