import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHeadBranchCleanup } from "../../scripts/lib/merge-branch-cleanup.mjs";

test("evaluateHeadBranchCleanup deletes the actor's own fork head after merge", () => {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: "Wibias",
    headOwnerLogin: "Wibias",
    headRefName: "feat/ri-02-request-history-index",
    isMerged: true,
    isCrossRepository: true,
    headRepo: "Wibias/opencodex",
    baseRepo: "lidge-jun/opencodex",
  });

  assert.equal(decision.action, "delete");
  assert.equal(decision.targetRepo, "Wibias/opencodex");
  assert.equal(decision.status, "branch deleted: Wibias/opencodex@feat/ri-02-request-history-index");
});

test("evaluateHeadBranchCleanup keeps another contributor's head", () => {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: "Wibias",
    headOwnerLogin: "other-contributor",
    headRefName: "feat/their-branch",
    isMerged: true,
    isCrossRepository: true,
    headRepo: "other-contributor/opencodex",
    baseRepo: "lidge-jun/opencodex",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "branch kept: head owned by @other-contributor");
  assert.equal(decision.status, "branch kept: head owned by @other-contributor");
});

test("evaluateHeadBranchCleanup prefers the gh pr view headRepository field for fork heads", () => {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: "Wibias",
    headOwnerLogin: "Wibias",
    headRefName: "feat/ri-04-policy-profile-core",
    isMerged: true,
    isCrossRepository: true,
    headRepository: "Wibias/opencodex",
    baseRepository: "lidge-jun/opencodex",
  });

  assert.equal(decision.action, "delete");
  assert.equal(decision.targetRepo, "Wibias/opencodex");
});

test("evaluateHeadBranchCleanup lets an explicit targetRepo win over head and base", () => {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: "Wibias",
    headOwnerLogin: "Wibias",
    headRefName: "feat/ri-04-policy-profile-core",
    isMerged: true,
    isCrossRepository: true,
    targetRepo: "Wibias/opencodex",
    headRepository: "fork-owner/opencodex",
    baseRepository: "lidge-jun/opencodex",
  });

  assert.equal(decision.action, "delete");
  assert.equal(decision.targetRepo, "Wibias/opencodex");
});
