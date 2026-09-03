import { buildWorkflowPacket } from "./delivery-workflow-profiles.mjs";

const NORMAL_HELPERS = Object.freeze({
  commentReviewGuard: "scripts/comment-review-guard.mjs",
  controller: "scripts/delivery-controller.mjs",
  mutation: "scripts/github-mutate.mjs",
  preOpenGate: "scripts/pre-open-gate.mjs",
  publicationPlanner: "scripts/create-pr-publication-plan.mjs",
  shipGate: "scripts/ship-gate.mjs",
});

const DECLARED_ACTIONS = Object.freeze({
  "create-pr-for-issue": Object.freeze([
    "assign_issue",
    "create_pr",
    "post_comment",
    "post_issue_comment",
    "post_review",
    "push_code",
    "reply_bot_thread",
    "resolve_bot_thread",
    "update_pr_body",
  ]),
  "create-pr-from-local-work": Object.freeze([
    "change_draft_state",
    "create_pr",
    "push_code",
  ]),
});

const WORKFLOW_PLANS = Object.freeze({
  "create-pr-from-local-work": Object.freeze({
    decisionAuthority: "workflow-packet+controller-checkpoint",
    sourceDiscovery: "diagnostic-only-on-helper-failure",
    instructionConflict: "fail-closed",
    preOpen: Object.freeze({
      output: "compact",
      decisionField: "decision",
      readyValue: "ready",
    }),
    publication: Object.freeze({
      initialCreate: "draft-only",
      planner: "scripts/create-pr-publication-plan.mjs",
      mutationEntrypoint: "scripts/github-mutate.mjs",
      directWriteFallback: "forbidden",
    }),
  }),
});

export function executionContractForWorkflow(workflow) {
  const workflowPlan = WORKFLOW_PLANS[workflow];
  return {
    helpers: { ...NORMAL_HELPERS },
    declaredActions: [...(DECLARED_ACTIONS[workflow] || [])],
    sourceDiscovery: "diagnostic-only",
    ...(workflowPlan ? { workflowPlan: structuredClone(workflowPlan) } : {}),
    normalOperation:
      "Use this packet and its declared helpers/actions for normal workflow execution. Do not re-decide a locked route, publication path, or initial PR state after packet/controller resolution. Read or grep github-delivery implementation source only after a concrete internal contract/helper failure requires diagnostic escalation. If a higher-priority instruction genuinely conflicts with the locked safe write path, fail closed once; do not fall back to a different GitHub write path.",
  };
}

export function buildExecutionWorkflowPacket(options = {}) {
  const packet = buildWorkflowPacket(options);
  return {
    ...packet,
    execution: executionContractForWorkflow(packet.workflow),
  };
}
