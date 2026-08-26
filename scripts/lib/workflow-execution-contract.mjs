import { buildWorkflowPacket } from "./delivery-workflow-profiles.mjs";

const NORMAL_HELPERS = Object.freeze({
  controller: "scripts/delivery-controller.mjs",
  mutation: "scripts/github-mutate.mjs",
  preOpenGate: "scripts/pre-open-gate.mjs",
  shipGate: "scripts/ship-gate.mjs",
});

const DECLARED_ACTIONS = Object.freeze({
  "create-pr-for-issue": Object.freeze([
    "assign_issue",
    "create_pr",
    "post_comment",
    "post_issue_comment",
    "push_code",
    "reply_bot_thread",
    "request_changes",
    "resolve_bot_thread",
    "update_pr_body",
  ]),
});

export function executionContractForWorkflow(workflow) {
  return {
    helpers: { ...NORMAL_HELPERS },
    declaredActions: [...(DECLARED_ACTIONS[workflow] || [])],
    sourceDiscovery: "diagnostic-only",
    normalOperation:
      "Use this packet and its declared helpers/actions for normal workflow execution. Read or grep github-delivery implementation source only after a concrete internal contract/helper failure requires diagnostic escalation.",
  };
}

export function buildExecutionWorkflowPacket(options = {}) {
  const packet = buildWorkflowPacket(options);
  return {
    ...packet,
    execution: executionContractForWorkflow(packet.workflow),
  };
}
