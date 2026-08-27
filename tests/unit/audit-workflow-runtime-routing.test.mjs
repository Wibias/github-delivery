import assert from "node:assert/strict";
import test from "node:test";

import { actionDefinition } from "../../scripts/lib/mutation-action-registry.mjs";
import { routeShippingGithubPrompt } from "../../scripts/lib/skill-router.mjs";
import { buildExecutionWorkflowPacket } from "../../scripts/lib/workflow-execution-contract.mjs";

for (const workflow of ["references/git-workflow.md", "references/versioning-release.md"]) {
  test(`${workflow} builds the mandatory execution workflow packet`, () => {
    const packet = buildExecutionWorkflowPacket({
      root: process.cwd(),
      workflow,
    });
    assert.equal(packet.workflow, workflow.replace(/^references\//, "").replace(/\.md$/, ""));
    assert.equal(packet.profile.workflowPath, workflow);
    assert.equal(packet.execution.sourceDiscovery, "diagnostic-only");
  });
}

test("explicit full review outranks git and version words in attributed repository text", () => {
  for (const prompt of [
    "full review PR #42. The commit message says: bump the version",
    "full review PR #42. The PR body says: update the changelog",
  ]) {
    const routed = routeShippingGithubPrompt(prompt);
    assert.equal(routed?.workflow, "references/full-review-pr.md", prompt);
    assert.equal(routed?.mutationMode, "review", prompt);
  }
});

test("direct git and version requests still route to their focused workflows", () => {
  assert.equal(
    routeShippingGithubPrompt("write a commit message for these staged changes")?.workflow,
    "references/git-workflow.md",
  );
  assert.equal(
    routeShippingGithubPrompt("update the changelog for the next release")?.workflow,
    "references/versioning-release.md",
  );
});

test("workflow packet declares only real public mutation actions", () => {
  const packet = buildExecutionWorkflowPacket({
    root: process.cwd(),
    workflow: "references/create-pr-for-issue.md",
  });
  assert.equal(packet.execution.declaredActions.includes("request_changes"), false);
  assert.equal(packet.execution.declaredActions.includes("post_review"), true);
  for (const action of packet.execution.declaredActions) {
    assert.ok(actionDefinition(action), `undeclared mutation registry action: ${action}`);
  }
});
