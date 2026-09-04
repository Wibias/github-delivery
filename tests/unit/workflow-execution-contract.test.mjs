import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutionWorkflowPacket } from "../../scripts/lib/workflow-execution-contract.mjs";

test("create-pr workflow packet exposes normal execution helpers and actions without source discovery", () => {
  const packet = buildExecutionWorkflowPacket({
    root: process.cwd(),
    workflow: "create-pr-for-issue",
  });

  assert.deepEqual(packet.execution.helpers, {
    commentReviewGuard: "scripts/comment-review-guard.mjs",
    controller: "scripts/delivery-controller.mjs",
    hygieneOrchestrator: "scripts/create-pr-hygiene.mjs",
    mutation: "scripts/github-mutate.mjs",
    preOpenEvidenceAssembler: "scripts/pre-open-review-evidence.mjs",
    preOpenGate: "scripts/pre-open-gate.mjs",
    publicationPlanner: "scripts/create-pr-publication-plan.mjs",
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

test("local-work create-pr packet locks the normal publication path", () => {
  const packet = buildExecutionWorkflowPacket({
    root: process.cwd(),
    workflow: "create-pr-from-local-work",
  });

  assert.deepEqual(packet.execution.declaredActions, [
    "change_draft_state",
    "create_pr",
    "push_code",
  ]);
  assert.equal(packet.execution.helpers.commentReviewGuard, "scripts/comment-review-guard.mjs");
  assert.equal(packet.execution.helpers.hygieneOrchestrator, "scripts/create-pr-hygiene.mjs");
  assert.equal(packet.execution.helpers.preOpenEvidenceAssembler, "scripts/pre-open-review-evidence.mjs");
  assert.equal(packet.execution.helpers.publicationPlanner, "scripts/create-pr-publication-plan.mjs");
  assert.deepEqual(packet.execution.workflowPlan, {
    decisionAuthority: "workflow-packet+controller-checkpoint",
    sourceDiscovery: "diagnostic-only-on-helper-failure",
    instructionConflict: "fail-closed",
    preOpen: {
      output: "compact",
      decisionField: "decision",
      readyValue: "ready",
      baseAuthority: "checkpoint-locked-remote",
      evidenceAssembler: "scripts/pre-open-review-evidence.mjs",
    },
    hygiene: {
      commentScope: "diff-added-lines",
      resultValidation: "structured-final-only",
      receiptAuthority: "pre-open-gate",
      orchestrator: "scripts/create-pr-hygiene.mjs",
    },
    publication: {
      initialCreate: "draft-only",
      planner: "scripts/create-pr-publication-plan.mjs",
      mutationEntrypoint: "scripts/github-mutate.mjs",
      directWriteFallback: "forbidden",
      directWriteGuard: "runtime-after-workflow-selection",
      completion: "broker-receipts",
    },
  });
  assert.match(packet.execution.normalOperation, /do not re-decide/i);
  assert.match(packet.execution.normalOperation, /do not fall back/i);
});
