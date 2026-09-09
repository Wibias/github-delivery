import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { executionContractForWorkflow } from "../../scripts/lib/workflow-execution-contract.mjs";

const DELIVERY_CONTROLLER = fileURLToPath(
  new URL("../../scripts/delivery-controller.mjs", import.meta.url),
);
const HEAD = "b".repeat(40);
const BASE = "a".repeat(40);
const GRAPH = {
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["LOCAL_VERIFY", "DONE"],
  LOCAL_VERIFY: ["DONE"],
  DONE: [],
};

function controller() {
  let at = 1_000;
  return createDeliveryWorkflowController({
    workflow: "create-pr-from-local-work",
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: GRAPH,
    startPhase: "ROUTE",
    now: () => ++at,
  });
}

test("controller exposes one authoritative current action and controller-owned phase receipts", () => {
  const current = controller();
  let snapshot = current.snapshot();
  assert.deepEqual(snapshot.nextAction, {
    action: "execute_phase",
    phase: "ROUTE",
    authority: "controller-checkpoint",
  });
  assert.deepEqual(snapshot.phaseReceipts, []);

  current.transition("PREFLIGHT");
  snapshot = current.snapshot();
  assert.deepEqual(snapshot.nextAction, {
    action: "execute_phase",
    phase: "PREFLIGHT",
    authority: "controller-checkpoint",
  });
  assert.equal(snapshot.phaseReceipts.length, 1);
  assert.deepEqual(snapshot.phaseReceipts[0], {
    phase: "ROUTE",
    authority: "controller-transition",
    stateGeneration: 0,
    baseSha: BASE,
    headSha: HEAD,
    issue: null,
    pr: null,
    completedAt: snapshot.phaseReceipts[0].completedAt,
  });
  assert.ok(Number.isFinite(snapshot.phaseReceipts[0].completedAt));

  current.transition("DONE");
  snapshot = current.snapshot();
  assert.deepEqual(snapshot.nextAction, {
    action: "stop",
    phase: "DONE",
    authority: "controller-checkpoint",
  });
  assert.deepEqual(snapshot.phaseReceipts.map((entry) => entry.phase), ["ROUTE", "PREFLIGHT"]);
});

test("checkpoint resume preserves receipts and the same singular next action", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-grounding-"));
  const checkpoint = join(directory, "checkpoint.json");
  try {
    const current = controller();
    current.transition("PREFLIGHT");
    writeDeliveryWorkflowCheckpoint(checkpoint, current.snapshot());

    const saved = readDeliveryWorkflowCheckpoint(checkpoint);
    const resumed = createDeliveryWorkflowController({ snapshot: saved, graph: GRAPH });
    assert.deepEqual(resumed.snapshot().nextAction, saved.nextAction);
    assert.deepEqual(resumed.snapshot().phaseReceipts, saved.phaseReceipts);
    assert.equal(resumed.snapshot().phase, "PREFLIGHT");
    assert.deepEqual(resumed.snapshot().completedPhases, ["ROUTE"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("model reasoning claims cannot change controller identity, phase, or receipts", () => {
  const current = controller();
  const before = current.snapshot();
  current.observeCycle({
    narrationChanged: true,
    claimedHeadSha: "f".repeat(40),
    claimedBaseSha: "e".repeat(40),
    claimedPr: 999,
    claimedChecks: "green",
    claimedPhase: "DONE",
  });
  const after = current.snapshot();

  assert.equal(after.headSha, before.headSha);
  assert.equal(after.baseSha, before.baseSha);
  assert.equal(after.pr, before.pr);
  assert.equal(after.phase, before.phase);
  assert.deepEqual(after.phaseReceipts, before.phaseReceipts);
  assert.deepEqual(after.nextAction, before.nextAction);
  assert.equal(after.attempts.noProgressSteps, 1);
});

test("public controller CLI cannot inject model-authored refs", () => {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-ref-grounding-"));
  const checkpoint = join(directory, "checkpoint.json");
  try {
    writeDeliveryWorkflowCheckpoint(checkpoint, controller().snapshot());
    const result = spawnSync(
      process.execPath,
      [DELIVERY_CONTROLLER, "refs", checkpoint, "--head", "f".repeat(40)],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    assert.match(`${result.stderr}\n${result.stdout}`, /controller_refs_are_internal_only/);
    assert.equal(readDeliveryWorkflowCheckpoint(checkpoint).headSha, HEAD);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("execution contract makes checkpoint state authoritative over reasoning claims", () => {
  const contract = executionContractForWorkflow("create-pr-from-local-work");
  assert.deepEqual(contract.controllerState, {
    source: "controller-checkpoint",
    nextAction: "authoritative",
    completedPhaseReceipts: "authoritative",
    reasoningClaims: "non-authoritative",
    externalStateClaims: "structured-evidence-only",
  });
});
