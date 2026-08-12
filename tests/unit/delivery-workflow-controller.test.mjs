import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";

const GRAPH = {
  ROUTE: ["PREFLIGHT"],
  PREFLIGHT: ["IMPLEMENT", "EXISTING_PR"],
  IMPLEMENT: ["LOCAL_VERIFY"],
  EXISTING_PR: ["REVIEW_FEEDBACK"],
  LOCAL_VERIFY: ["REVIEW_FEEDBACK"],
  REVIEW_FEEDBACK: ["CI"],
  CI: ["FINAL_GATE"],
  FINAL_GATE: ["DONE"],
  DONE: [],
};

function controller(options = {}) {
  return createDeliveryWorkflowController({
    workflow: "create-pr-for-issue",
    repo: "o/r",
    issue: 1477,
    graph: GRAPH,
    startPhase: "ROUTE",
    now: () => 1_000,
    budgets: {
      noProgressWarn: 2,
      noProgressRestrictEvidence: 3,
      noProgressInterrupt: 4,
      maxPhaseRetries: 2,
      maxWorkflowSteps: 8,
      maxEvidenceActions: 5,
      maxWorkflowTokens: 100,
      maxPhaseTokens: 60,
      maxWallTimeMs: 10_000,
    },
    ...options,
  });
}

test("workflow route is locked after controller creation", () => {
  const c = controller();
  assert.equal(c.snapshot().workflow, "create-pr-for-issue");
  assert.throws(() => c.setWorkflow("full-review-pr"), /route.*locked/i);
  assert.doesNotThrow(() => c.setWorkflow("create-pr-for-issue"));
});

test("only declared workflow transitions are legal and completed phases are persisted", () => {
  const c = controller();
  assert.throws(() => c.transition("CI"), /illegal.*transition/i);
  c.transition("PREFLIGHT");
  c.transition("EXISTING_PR");
  assert.deepEqual(c.snapshot().completedPhases, ["ROUTE", "PREFLIGHT"]);
  assert.equal(c.snapshot().phase, "EXISTING_PR");
});

test("repeated cycles without measurable progress escalate deterministically", () => {
  const c = controller();
  assert.equal(c.observeCycle({}).action, "allow");
  assert.equal(c.observeCycle({}).action, "warn");
  assert.equal(c.observeCycle({}).action, "restrict-evidence");
  const stopped = c.observeCycle({});
  assert.equal(stopped.action, "interrupt");
  assert.equal(stopped.reason, "workflow_no_progress_limit");
});

test("real progress resets the no-progress counter while narration does not", () => {
  const c = controller();
  c.observeCycle({});
  c.observeCycle({});
  assert.equal(c.snapshot().attempts.noProgressSteps, 2);
  c.observeCycle({ executionCompleted: true });
  assert.equal(c.snapshot().attempts.noProgressSteps, 0);
  c.observeCycle({ narrationChanged: true });
  assert.equal(c.snapshot().attempts.noProgressSteps, 1);
});

test("blocker removal and missing required evidence count as measurable progress", () => {
  const c = controller();
  c.addBlocker("ci-red");
  c.observeCycle({});
  c.removeBlocker("ci-red");
  assert.equal(c.observeCycle({ blockerRemoved: true }).action, "allow");
  assert.equal(c.snapshot().attempts.noProgressSteps, 0);

  c.observeCycle({});
  assert.equal(c.observeCycle({ requiredEvidenceProduced: true }).action, "allow");
  assert.equal(c.snapshot().attempts.noProgressSteps, 0);
});

test("phase retry evidence and workflow step budgets are hard bounds", () => {
  const c = controller({
    budgets: {
      noProgressWarn: 20,
      noProgressRestrictEvidence: 30,
      noProgressInterrupt: 40,
      maxPhaseRetries: 2,
      maxWorkflowSteps: 3,
      maxEvidenceActions: 2,
      maxWorkflowTokens: 100,
      maxPhaseTokens: 60,
      maxWallTimeMs: 10_000,
    },
  });

  assert.equal(c.recordPhaseRetry().action, "allow");
  assert.equal(c.recordPhaseRetry().action, "interrupt");
  assert.equal(c.recordEvidenceAction().action, "allow");
  assert.equal(c.recordEvidenceAction().action, "restrict-evidence");

  c.observeCycle({ executionCompleted: true });
  c.observeCycle({ executionCompleted: true });
  const stepLimit = c.observeCycle({ executionCompleted: true });
  assert.equal(stepLimit.action, "interrupt");
  assert.equal(stepLimit.reason, "workflow_step_limit");
});

test("workflow token phase token and wall-time ceilings interrupt independently", () => {
  assert.equal(
    controller().observeResourceUsage({ workflowTokens: 101, phaseTokens: 10, now: 1_100 }).reason,
    "workflow_token_limit",
  );
  assert.equal(
    controller().observeResourceUsage({ workflowTokens: 50, phaseTokens: 61, now: 1_100 }).reason,
    "phase_token_limit",
  );
  assert.equal(
    controller().observeResourceUsage({ workflowTokens: 10, phaseTokens: 10, now: 11_001 }).reason,
    "workflow_wall_time_limit",
  );
});

test("semantic evidence is reused within a state generation and invalidated by head change", () => {
  const c = controller({ headSha: "aaa" });
  c.recordEvidence({
    key: "pr-ci:o/r:1499",
    covers: ["checks", "failure-origin"],
    authoritative: true,
  });
  assert.equal(
    c.decideEvidence({ key: "pr-ci:o/r:1499", requires: ["checks"] }).action,
    "block",
  );

  c.updateRefs({ headSha: "bbb" });
  assert.equal(
    c.decideEvidence({ key: "pr-ci:o/r:1499", requires: ["checks"] }).action,
    "allow",
  );
});

test("checkpoint resume retains route phase blockers budgets and attempt counters", () => {
  const c = controller({ headSha: "abc", baseSha: "def" });
  c.transition("PREFLIGHT");
  c.addBlocker("needs-review");
  c.observeCycle({});
  c.recordEvidenceAction();

  const dir = mkdtempSync(join(tmpdir(), "gd-controller-"));
  const path = join(dir, "checkpoint.json");
  writeDeliveryWorkflowCheckpoint(path, c.snapshot());
  const saved = readDeliveryWorkflowCheckpoint(path);
  const resumed = createDeliveryWorkflowController({ snapshot: saved, graph: GRAPH, now: () => 2_000 });

  assert.equal(resumed.snapshot().workflow, "create-pr-for-issue");
  assert.equal(resumed.snapshot().phase, "PREFLIGHT");
  assert.deepEqual(resumed.snapshot().blockers, ["needs-review"]);
  assert.equal(resumed.snapshot().attempts.noProgressSteps, 1);
  assert.equal(resumed.snapshot().attempts.evidenceActions, 1);
  assert.deepEqual(resumed.snapshot().completedPhases, ["ROUTE"]);
});

test("resume cannot move backward into an already completed phase", () => {
  const c = controller();
  c.transition("PREFLIGHT");
  c.transition("IMPLEMENT");
  const resumed = createDeliveryWorkflowController({ snapshot: c.snapshot(), graph: GRAPH });
  assert.throws(() => resumed.transition("ROUTE"), /illegal.*transition|completed/i);
});
