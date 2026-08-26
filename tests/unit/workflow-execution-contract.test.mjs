import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutionWorkflowPacket } from "../../scripts/lib/workflow-execution-contract.mjs";

test("create-pr workflow packet exposes normal execution helpers and actions without source discovery", () => {
  const packet = buildExecutionWorkflowPacket({
    root: process.cwd(),
    workflow: "create-pr-for-issue",
  });

  assert.deepEqual(packet.execution.helpers, {
    controller: "scripts/delivery-controller.mjs",
    mutation: "scripts/github-mutate.mjs",
    preOpenGate: "scripts/pre-open-gate.mjs",
    shipGate: "scripts/ship-gate.mjs",
  });
  assert.equal(packet.execution.sourceDiscovery, "diagnostic-only");
  assert.match(packet.execution.normalOperation, /concrete internal contract\/helper failure/i);
  for (const action of [
    "push_code",
    "create_pr",
    "assign_issue",
    "post_issue_comment",
    "update_pr_body",
    "reply_bot_thread",
  ]) {
    assert.equal(packet.execution.declaredActions.includes(action), true, action);
  }
});
