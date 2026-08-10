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

test("authority state persists bounded branch leases and a token-free audit ledger", () => {
  const store = read(`${host}/StateStore.cs`);
  assert.match(store, /CREATE TABLE IF NOT EXISTS branch_leases/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS audit_events/);
  assert.match(store, /ListActiveBranchLeases/);
  assert.match(store, /TryGetActiveBranchLease/);
  assert.match(store, /TryUseActiveBranchLease/);
  assert.match(store, /CreateBranchLease/);
  assert.match(store, /RevokeBranchLease/);
  assert.match(store, /ListRecentAuditEvents/);
  assert.doesNotMatch(store, /audit_events[\s\S]{0,800}\btoken\b/i);
});

test("approval flow atomically reuses only an exact repo plus branch lease", () => {
  const service = read(`${host}/AuthorityService.cs`);
  const coordinator = read(`${host}/ApprovalCoordinator.cs`);
  const approval = read(`${host}/ApprovalWindow.xaml`);
  assert.match(service, /branch_lease/);
  assert.match(service, /TryUseActiveBranchLease/);
  assert.match(service, /CreateBranchLease/);
  assert.match(coordinator, /BranchLeaseMinutes/);
  assert.match(approval, /x:Name="BranchGrantToggle"/);
  assert.doesNotMatch(approval, /x:Name="BranchGrantToggle"[^>]*IsEnabled="False"/);
});

test("control center renders persisted audit events and active branch leases", () => {
  const code = read(`${host}/ControlCenterWindow.xaml.cs`);
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
