import assert from "node:assert/strict";
import test from "node:test";

import { createDeliveryWorkflowController } from "../../scripts/lib/delivery-workflow-controller.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const GRAPH = {
  PREOPEN_GATE: ["OPEN_PR"],
  OPEN_PR: ["DONE"],
  DONE: [],
};

test("create-PR workflow cannot enter publication without ready pre-open evidence", () => {
  const controller = createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: "acme/widgets",
    baseSha: BASE,
    headSha: HEAD,
    graph: GRAPH,
    startPhase: "PREOPEN_GATE",
  });

  assert.throws(
    () => controller.transition("OPEN_PR"),
    /pre_open_evidence_missing/,
  );
});
