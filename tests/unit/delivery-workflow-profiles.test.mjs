import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkflowPacket,
  listDeliveryWorkflowProfiles,
  resolveDeliveryWorkflowProfile,
} from "../../scripts/lib/delivery-workflow-profiles.mjs";

const ROUTED_WORKFLOWS = [
  "issue-workflows",
  "agent-brief",
  "out-of-scope",
  "fix-pr-bots",
  "watch-pr",
  "re-review-pr",
  "research-issue",
  "create-pr-from-local-work",
  "create-pr-for-issue",
  "open-work-status",
  "full-review-pr",
  "spec-standards-review",
  "simplify-pr",
  "security-review",
  "status",
  "merge-pr",
  "supersede-pr",
  "overtake-pr",
  "resolve-conflicts",
  "stacked-prs",
  "prepare-and-merge-pr",
];

test("every routed GitHub Delivery workflow has a controller profile", () => {
  const available = new Set(listDeliveryWorkflowProfiles().map((profile) => profile.workflow));
  for (const workflow of ROUTED_WORKFLOWS) {
    assert.equal(available.has(workflow), true, `missing controller profile: ${workflow}`);
  }
});

test("create PR profile preserves bounded preflight through final gate lifecycle", () => {
  const profile = resolveDeliveryWorkflowProfile("references/create-pr-for-issue.md");
  assert.equal(profile.workflow, "create-pr-for-issue");
  assert.deepEqual(profile.graph.PREFLIGHT, ["IMPLEMENT", "EXISTING_PR", "DONE"]);
  assert.deepEqual(profile.graph.IMPLEMENT, ["LOCAL_VERIFY"]);
  assert.deepEqual(profile.graph.CI, ["FINAL_GATE"]);
  assert.deepEqual(profile.graph.FINAL_GATE, ["DONE"]);
});

test("status profiles cannot drift into mutation phases", () => {
  for (const workflow of ["status", "open-work-status"]) {
    const profile = resolveDeliveryWorkflowProfile(workflow);
    assert.equal(profile.mutation, "read-only", workflow);
    const phases = new Set(Object.keys(profile.graph));
    for (const forbidden of ["IMPLEMENT", "PUBLISH_CHANGE", "MERGE", "PUBLISH"]) {
      assert.equal(phases.has(forbidden), false, `${workflow}:${forbidden}`);
    }
  }
});

test("one-shot workflow packet contains selected workflow and unconditional policy exactly once", () => {
  const packet = buildWorkflowPacket({
    root: process.cwd(),
    workflow: "status",
  });
  assert.equal(packet.kind, "github-delivery/workflow-packet");
  assert.equal(packet.workflow, "status");
  assert.equal(packet.profile.workflow, "status");
  const paths = packet.documents.map((document) => document.path);
  assert.equal(paths.length, new Set(paths).size);
  assert.equal(paths.includes("references/status.md"), true);
  assert.equal(paths.includes("references/policy-kernel.md"), true);
  assert.equal(paths.includes("references/shared-rules.md"), false);
  assert.match(packet.packetHash, /^[a-f0-9]{64}$/);
  for (const document of packet.documents) {
    assert.match(document.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof document.content, "string");
    assert.ok(document.content.length > 0);
  }
});

test("open-work packet loads only its read-only evidence bundle", () => {
  const packet = buildWorkflowPacket({ root: process.cwd(), workflow: "open-work-status" });
  const paths = packet.documents.map((document) => document.path);
  assert.equal(paths.includes("references/open-work-status.md"), true);
  assert.equal(paths.includes("references/policy-kernel.md"), true);
  assert.equal(paths.includes("references/policy/evidence.md"), true);
  assert.equal(paths.includes("references/policy/mutation.md"), false);
  assert.equal(paths.includes("references/policy/ci.md"), false);
  assert.equal(paths.includes("references/policy/reviews.md"), false);
});

test("conditional modules are excluded by default and included only when explicitly activated", () => {
  const base = buildWorkflowPacket({
    root: process.cwd(),
    workflow: "create-pr-for-issue",
  });
  const conditional = base.policy.conditionalModules[0];
  if (!conditional) return;

  assert.equal(base.documents.some((document) => document.path === conditional.path), false);
  const activated = buildWorkflowPacket({
    root: process.cwd(),
    workflow: "create-pr-for-issue",
    activeConditionalModules: [conditional.module],
  });
  assert.equal(
    activated.documents.filter((document) => document.path === conditional.path).length,
    1,
  );
});

test("unknown or non-routed workflow names fail closed", () => {
  assert.throws(() => resolveDeliveryWorkflowProfile("made-up-workflow"), /unknown.*workflow/i);
  assert.throws(
    () => buildWorkflowPacket({ root: process.cwd(), workflow: "made-up-workflow" }),
    /unknown.*workflow/i,
  );
});
