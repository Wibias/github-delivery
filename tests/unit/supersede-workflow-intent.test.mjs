import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDeliveryWorkflowController,
  readDeliveryWorkflowCheckpoint,
  writeDeliveryWorkflowCheckpoint,
} from "../../scripts/lib/delivery-workflow-controller.mjs";
import { resolveDeliveryWorkflowProfile } from "../../scripts/lib/delivery-workflow-profiles.mjs";
import { mutationExecutionContextFromCheckpoint } from "../../scripts/lib/mutation-checkpoint.mjs";
import { executeMutationDocument } from "../../scripts/lib/mutation-document-execution.mjs";
import { authorizeMutation } from "../../scripts/lib/mutation-policy.mjs";

const HEAD = "b".repeat(40);
const BASE = "a".repeat(40);

function closeRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "close_pr",
    mutationMode: "maintainer",
    repo: "acme/widgets",
    pr: 95,
    expectedHead: HEAD,
    ...overrides,
  };
}

function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "github-delivery-supersede-intent-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "controller.json");
  const profile = resolveDeliveryWorkflowProfile("supersede-pr");
  const controller = createDeliveryWorkflowController({
    workflow: profile.workflow,
    repo: "acme/widgets",
    pr: 95,
    baseSha: BASE,
    headSha: HEAD,
    graph: profile.graph,
    startPhase: "ROUTE",
    ...overrides,
  });
  for (const phase of ["PREFLIGHT", "PREPARE", "PUBLISH_CHANGE"]) {
    controller.transition(phase);
  }
  writeDeliveryWorkflowCheckpoint(path, controller.snapshot());
  return path;
}

function context(path, request = closeRequest()) {
  return mutationExecutionContextFromCheckpoint({ path, request });
}

test("supersede publish phase authorizes only the exact obsolete PR close", t => {
  const path = fixture(t);
  assert.deepEqual(context(path), {
    trustedWorkflowIntent: true,
    trustedExactTextConfirmation: false,
  });
  assert.equal(context(path).trustedWorkflowIntent, true);
  assert.throws(() => context(path, closeRequest({ repo: "other/widgets" })), /mutation_checkpoint_repo_mismatch/);
  assert.throws(() => context(path, closeRequest({ pr: 96 })), /mutation_workflow_intent_pr_mismatch/);
  assert.throws(() => context(path, closeRequest({ expectedHead: "c".repeat(40) })), /mutation_workflow_intent_head_mismatch/);
  assert.throws(() => context(path, closeRequest({ expectedHead: undefined })), /mutation_workflow_intent_head_mismatch/);
  assert.throws(() => context(path, closeRequest({ mutationMode: "autonomous" })), /mutation_workflow_intent_mode_mismatch/);
  assert.throws(() => context(path, closeRequest({ explicitInstruction: true })), /mutation_workflow_intent_operation_mismatch/);
  assert.equal(context(path, closeRequest({ action: "merge_pr" })).trustedWorkflowIntent, false);
  assert.equal(context(path, closeRequest({ action: "delete_head_branch" })).trustedWorkflowIntent, false);
  assert.equal(context(path, closeRequest({ action: "post_comment", body: "Superseded." })).trustedWorkflowIntent, false);
});

test("supersede close requires a complete controller target", t => {
  for (const [overrides, expected] of [
    [{ pr: null }, /mutation_workflow_intent_pr_mismatch/],
    [{ headSha: null }, /mutation_workflow_intent_head_mismatch/],
    [{ headSha: "b" }, /mutation_workflow_intent_head_mismatch/],
  ]) {
    assert.throws(() => context(fixture(t, overrides)), expected);
  }
});

test("supersede close intent is unavailable outside the publish phase, including after prior authorization", t => {
  const path = fixture(t);
  const profile = resolveDeliveryWorkflowProfile("supersede-pr");
  const controller = createDeliveryWorkflowController({
    snapshot: readDeliveryWorkflowCheckpoint(path), graph: profile.graph,
  });
  const initial = controller.snapshot();
  for (const phase of ["ROUTE", "PREFLIGHT", "PREPARE"]) {
    writeDeliveryWorkflowCheckpoint(path, { ...initial, phase });
    assert.equal(context(path).trustedWorkflowIntent, false);
  }
  writeDeliveryWorkflowCheckpoint(path, initial);
  assert.equal(context(path).trustedWorkflowIntent, true);
  const authorized = createDeliveryWorkflowController({
    snapshot: readDeliveryWorkflowCheckpoint(path), graph: profile.graph,
  });
  authorized.transition("VERIFY");
  writeDeliveryWorkflowCheckpoint(path, authorized.snapshot());
  assert.equal(context(path).trustedWorkflowIntent, false);
});

test("Protection Off routes the exact close through the existing mutation boundary", t => {
  const path = fixture(t);
  let executed = 0;
  const result = executeMutationDocument({
    document: closeRequest(),
    execute: true,
    env: { ...process.env, GITHUB_DELIVERY_AUTHORITY_MODE: "off" },
    dependencies: {
      executionContextForRequest: request => context(path, request),
      authorizeBatchSync() { assert.fail("Protection Off must not call the authority host"); },
      executeMutationWithAuthority(options) {
        assert.equal(options.trustedWorkflowIntent, true);
        assert.equal(options.request.action, "close_pr");
        assert.equal(options.request.pr, 95);
        executed += 1;
        return { action: "close_pr", request: options.request, status: "succeeded" };
      },
    },
  });
  assert.equal(executed, 1);
  assert.equal(result.status, "succeeded");
});

test("standalone close cannot self-authorize with a caller flag", () => {
  assert.equal(context(null, closeRequest({ explicitInstruction: true })).trustedWorkflowIntent, false);
  assert.equal(authorizeMutation({ mode: "maintainer", action: "close_pr" }).reason, "explicit_instruction_required");
});
