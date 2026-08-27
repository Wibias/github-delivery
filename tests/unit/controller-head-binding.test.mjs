import assert from "node:assert/strict";
import test from "node:test";

import { createDeliveryWorkflowController } from "../../scripts/lib/delivery-workflow-controller.mjs";
import * as snapshotInput from "../../scripts/lib/snapshot-input.mjs";

const OLD_HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);
const GRAPH = { ROUTE: ["DONE"], DONE: [] };

function controller() {
  return createDeliveryWorkflowController({
    workflow: "status",
    repo: "acme/widgets",
    pr: 32,
    headSha: OLD_HEAD,
    graph: GRAPH,
    startPhase: "ROUTE",
  });
}

test("successful push reconciliation advances the controller-owned head generation", () => {
  const current = controller();
  assert.equal(typeof current.reconcileMutationResult, "function");

  const result = current.reconcileMutationResult({
    action: "push_code",
    status: "succeeded",
    request: {
      repo: "acme/widgets",
      newTip: NEW_HEAD,
    },
  });

  assert.equal(result.changed, true);
  assert.equal(current.snapshot().headSha, NEW_HEAD);
  assert.equal(current.snapshot().stateGeneration, 1);
});

test("ship-gate binding derives target and expected head from the controller and rejects conflicts", () => {
  assert.equal(typeof snapshotInput.bindSnapshotGateToController, "function");
  const controllerSnapshot = controller().snapshot();

  assert.deepEqual(
    snapshotInput.bindSnapshotGateToController({
      gate: {
        repo: null,
        pr: null,
        expectedHead: null,
      },
      controller: controllerSnapshot,
    }),
    {
      repo: "acme/widgets",
      pr: 32,
      expectedHead: OLD_HEAD,
    },
  );

  assert.throws(
    () => snapshotInput.bindSnapshotGateToController({
      gate: {
        repo: "acme/widgets",
        pr: 32,
        expectedHead: NEW_HEAD,
      },
      controller: controllerSnapshot,
    }),
    /controller_head_conflict/,
  );
});
