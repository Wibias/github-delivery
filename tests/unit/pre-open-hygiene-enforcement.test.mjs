import assert from "node:assert/strict";
import test from "node:test";

import { createDeliveryWorkflowController } from "../../scripts/lib/delivery-workflow-controller.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const NEXT_HEAD = "c".repeat(40);
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
    baseRefOid: BASE,
    headRefOid: HEAD,
    diffIdentity: `sha256:${"d".repeat(64)}`,
    fileCount: 3,
  };
}

function hygienePasses(headSha = HEAD) {
  return {
    noComments: { status: "done", headSha, recordedAt: 1 },
    simplify: { status: "done", headSha, recordedAt: 1 },
  };
}

function controller({ hygiene = false } = {}) {
  return createDeliveryWorkflowController({
    workflow: "create-pr-from-local-work",
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: GRAPH,
    startPhase: "PREOPEN_GATE",
    ...(hygiene ? { hygienePasses: hygienePasses() } : {}),
  });
}

test("ready pre-open evidence cannot publish before both default hygiene passes complete", () => {
  const current = controller();
  current.recordPreOpenGate(readyGate());

  assert.throws(
    () => current.transition("OPEN_PR"),
    /pre_open_hygiene_no_comments_missing/,
  );
});

test("current-head no-comments and simplify receipts allow publication", () => {
  const current = controller({ hygiene: true });
  current.recordPreOpenGate(readyGate());

  const snapshot = current.snapshot();
  assert.equal(snapshot.hygienePasses.noComments.status, "done");
  assert.equal(snapshot.hygienePasses.noComments.headSha, HEAD);
  assert.equal(snapshot.hygienePasses.simplify.status, "done");
  assert.equal(snapshot.hygienePasses.simplify.headSha, HEAD);
  assert.equal(current.transition("OPEN_PR").phase, "OPEN_PR");
});

test("changing the candidate head invalidates completed hygiene receipts", () => {
  const current = controller({ hygiene: true });
  current.recordPreOpenGate(readyGate());
  current.updateRefs({ headSha: NEXT_HEAD });

  assert.throws(
    () => current.transition("OPEN_PR"),
    /pre_open_hygiene_no_comments_stale/,
  );
});
