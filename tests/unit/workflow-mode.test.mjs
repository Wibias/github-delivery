import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedMutationModes,
  validateWorkflowMutationMode,
} from "../../scripts/lib/workflow-mode.mjs";

test("full review accepts review and maintainer but never read-only", () => {
  assert.deepEqual(allowedMutationModes("references/full-review-pr.md"), [
    "review",
    "maintainer",
  ]);
  assert.equal(
    validateWorkflowMutationMode({
      workflow: "references/full-review-pr.md",
      mutationMode: "review",
    }).valid,
    true,
  );
  assert.equal(
    validateWorkflowMutationMode({
      workflow: "references/full-review-pr.md",
      mutationMode: "maintainer",
    }).valid,
    true,
  );
  const denied = validateWorkflowMutationMode({
    workflow: "references/full-review-pr.md",
    mutationMode: "read-only",
  });
  assert.equal(denied.valid, false);
  assert.equal(denied.reason, "mode_denied_by_workflow");
  assert.deepEqual(denied.allowedModes, ["review", "maintainer"]);
});

test("read-only workflows reject elevated modes", () => {
  for (const workflow of ["references/status.md", "references/open-work-status.md"]) {
    assert.deepEqual(allowedMutationModes(workflow), ["read-only"]);
    assert.equal(
      validateWorkflowMutationMode({ workflow, mutationMode: "read-only" }).valid,
      true,
      workflow,
    );
    const denied = validateWorkflowMutationMode({ workflow, mutationMode: "maintainer" });
    assert.equal(denied.valid, false, workflow);
    assert.equal(denied.reason, "mode_denied_by_workflow", workflow);
  }
});

test("watch accepts only its declared read-only and autonomous modes", () => {
  assert.equal(
    validateWorkflowMutationMode({
      workflow: "references/watch-pr.md",
      mutationMode: "read-only",
    }).valid,
    true,
  );
  assert.equal(
    validateWorkflowMutationMode({
      workflow: "references/watch-pr.md",
      mutationMode: "autonomous",
    }).valid,
    true,
  );
  assert.equal(
    validateWorkflowMutationMode({
      workflow: "references/watch-pr.md",
      mutationMode: "review",
    }).valid,
    false,
  );
});

test("supersede and overtake require maintainer mode", () => {
  for (const workflow of [
    "references/supersede-pr.md",
    "references/overtake-pr.md",
  ]) {
    assert.deepEqual(allowedMutationModes(workflow), ["maintainer"]);
    assert.equal(
      validateWorkflowMutationMode({
        workflow,
        mutationMode: "maintainer",
      }).valid,
      true,
    );
    const denied = validateWorkflowMutationMode({
      workflow,
      mutationMode: "review",
    });
    assert.equal(denied.valid, false);
    assert.equal(denied.reason, "mode_denied_by_workflow");
  }
});

test("unknown workflows fail closed", () => {
  const result = validateWorkflowMutationMode({
    workflow: "references/typo.md",
    mutationMode: "review",
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unknown_workflow");
  assert.deepEqual(result.allowedModes, []);
});
