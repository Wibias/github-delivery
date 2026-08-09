import assert from "node:assert/strict";
import test from "node:test";

import { evaluateHeadBranchCleanup } from "../../scripts/lib/merge-branch-cleanup.mjs";

test("evaluateHeadBranchCleanup keeps the actor's own fork head until deletion can be expected-tip bound", () => {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: "Wibias",
    headOwnerLogin: "Wibias",
    headRefName: "feat/ri-02-request-history-index",
    isMerged: true,
    isCrossRepository: true,
    headRepo: "Wibias/opencodex",
    baseRepo: "lidge-jun/opencodex",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.targetRepo, "Wibias/opencodex");
  assert.match(decision.reason, /automatic deletion disabled/i);
  assert.equal(decision.status, decision.reason);
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

test("evaluateHeadBranchCleanup retains resolved fork repository in disabled cleanup decision", () => {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: "Wibias",
    headOwnerLogin: "Wibias",
    headRefName: "feat/ri-04-policy-profile-core",
    isMerged: true,
    isCrossRepository: true,
    headRepository: "Wibias/opencodex",
    baseRepository: "lidge-jun/opencodex",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.targetRepo, "Wibias/opencodex");
  assert.match(decision.reason, /automatic deletion disabled/i);
});

test("evaluateHeadBranchCleanup still prefers an explicit targetRepo while deletion is disabled", () => {
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

  assert.equal(decision.action, "skip");
  assert.equal(decision.targetRepo, "Wibias/opencodex");
  assert.match(decision.reason, /automatic deletion disabled/i);
});

test("evaluateHeadBranchCleanup honors an explicit keep request", () => {
  const decision = evaluateHeadBranchCleanup({
    actorLogin: "Wibias",
    headOwnerLogin: "Wibias",
    headRefName: "feat/keep-me",
    isMerged: true,
    keepBranch: true,
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.reason, "branch kept: user requested keep");
});
