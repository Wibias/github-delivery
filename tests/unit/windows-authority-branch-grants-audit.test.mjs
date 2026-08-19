import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  authorityScopeForRequest,
  authorityScopeSha256,
} from "../../scripts/lib/authority-scope.mjs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const host = "authority-host/windows/GitHubDeliveryAuthority";

function commentRequest(authorityBranch) {
  return {
    action: "post_comment",
    mutationMode: "maintainer",
    repo: "acme/widgets",
    pr: 42,
    expectedHead: "a".repeat(40),
    authorityBranch,
    body: "status",
    idempotencyKey: "audit-42",
  };
}

test("authority branch is part of the exact signed scope", () => {
  const first = commentRequest("feature/a");
  const second = commentRequest("feature/b");
  assert.equal(authorityScopeForRequest(first).authorityBranch, "feature/a");
  assert.notEqual(authorityScopeSha256(first), authorityScopeSha256(second));
});

test("branch lease resolver accepts authorityBranch only for PR-bound operations", () => {
  const scope = read(`${host}/BranchScope.cs`);
  assert.match(scope, /PrBoundActions/);
  assert.match(scope, /PrBoundActions\.Contains\(action\)/);
  assert.doesNotMatch(scope, /"delete_head_branch"\s*=>/);
});

test("authority state persists bounded branch leases and a token-free audit ledger", () => {
  const store = read(`${host}/StateStore.cs`);
  assert.match(store, /CREATE TABLE IF NOT EXISTS branch_leases/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS audit_events/);
  assert.match(store, /ListActiveBranchLeases/);
  assert.match(store, /TryGetActiveBranchLease/);
  assert.match(store, /TryUseActiveBranchLease/);
  assert.match(store, /CreateBranchLease/);
  assert.match(store, /RevokeBranchLease/);
  assert.match(store, /RecordExpiredBranchLeases/);
  assert.match(store, /ListRecentAuditEvents/);
  assert.doesNotMatch(store, /audit_events[\s\S]{0,800}\btoken\b/i);
});

test("branch lease duration is bounded to one through ten minutes at host boundaries", () => {
  const store = read(`${host}/StateStore.cs`);
  const coordinator = read(`${host}/ApprovalCoordinator.cs`);
  const window = read(`${host}/ApprovalWindow.xaml.cs`);

  assert.match(store, /minutes is < 1 or > 10/);
  assert.match(coordinator, /minutes < 1 \|\| minutes > 10/);
  assert.match(window, /minutes is >= 1 and <= 10/);
});

test("branch leases can authorize repeated code pushes but never another action class", () => {
  const service = read(`${host}/AuthorityService.cs`);
  const classifier = read(`${host}/MutationClassifier.cs`);
  const approval = read(`${host}/ApprovalWindow.xaml`);

  assert.match(classifier, /IsBranchLeaseEligible/);
  assert.match(classifier, /"push_code"/);
  assert.match(service, /operations\.All\(MutationClassifier\.IsBranchLeaseEligible\)/);
  assert.match(service, /branchLeaseEligible\s*\?\s*_store\.TryUseActiveBranchLease/);
  assert.match(service, /branchLeaseEligible \? branch : null/);
  assert.match(service, /branch_lease_action_not_eligible/);
  assert.match(approval, /x:Name="BranchGrantToggle"/);
  assert.doesNotMatch(approval, /x:Name="BranchGrantToggle"[^>]*IsEnabled="False"/);
});

test("control center renders persisted audit events, expiries, and active branch leases", () => {
  const code = read(`${host}/ControlCenterWindow.xaml.cs`);
  assert.match(code, /RecordExpiredBranchLeases/);
  assert.match(code, /ListRecentAuditEvents/);
  assert.match(code, /ListActiveBranchLeases/);
  assert.doesNotMatch(code, /Detailed event history lands in the audit-ledger PR/);
  assert.doesNotMatch(code, /No active temporary branch grants" \}/);
});

test("host self-test covers lease expiry, repo-branch isolation, atomic use, audit recording, and revocation", () => {
  const selfTest = read(`${host}/SelfTest.cs`);
  for (const marker of [
    "branch_lease_scope",
    "branch_lease_atomic_use",
    "branch_lease_expiry",
    "branch_lease_revocation",
    "audit_event_roundtrip",
  ]) assert.match(selfTest, new RegExp(marker));
});
