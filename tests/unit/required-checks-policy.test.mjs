import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateRequiredCheckCompleteness,
  evaluateRequiredChecks,
  latestLiveChecks,
  normalizeRequiredChecks,
  selectAuthoritativeCheckEvidence,
} from "../../scripts/lib/required-checks-policy.mjs";

function run(name, appId, conclusion, overrides = {}) {
  return {
    id: overrides.id || 1,
    name,
    status: overrides.status || "completed",
    conclusion,
    completed_at: overrides.completed_at || "2026-08-01T00:00:00Z",
    app: { id: appId, slug: `app-${appId}` },
  };
}

function status(context, state, createdAt = "2026-08-01T00:00:00Z") {
  return { context, state, created_at: createdAt, creator: { login: "ci" } };
}

test("preserves app-bound required checks", () => {
  const policy = normalizeRequiredChecks({
    classicRequiredStatusChecks: {
      checks: [
        { context: "build", app_id: 11 },
        { context: "build", app_id: 22 },
      ],
    },
  });
  assert.deepEqual(
    policy.descriptors.map(({ context, appId }) => ({ context, appId })),
    [
      { context: "build", appId: 11 },
      { context: "build", appId: 22 },
    ],
  );
});

test("ruleset integration_id is preserved", () => {
  const policy = normalizeRequiredChecks({
    activeRules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "lint", integration_id: 77 }],
        },
      },
    ],
  });
  assert.equal(policy.descriptors[0].appId, 77);
});

test("an app-bound requirement cannot be satisfied by another app", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: ["classic_check"] }],
    checkRuns: [run("build", 22, "success")],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.requiredStatus[0].gate, "missing");
});

test("unbound duplicate producers fail when any producer fails", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: null, sources: ["classic_context"] }],
    checkRuns: [run("build", 11, "success"), run("build", 22, "failure")],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.requiredStatus[0].ambiguous, true);
  assert.equal(result.requiredStatus[0].gate, "fail");
});

test("latest check run per app wins over an older rerun", () => {
  const live = latestLiveChecks({
    checkRuns: [
      run("build", 11, "failure", {
        completed_at: "2026-08-01T00:00:00Z",
        id: 1,
      }),
      run("build", 11, "success", {
        completed_at: "2026-08-01T01:00:00Z",
        id: 2,
      }),
    ],
  });
  assert.equal(live.length, 1);
  assert.equal(live[0].gate, "pass");
});

test("latest commit status per context wins", () => {
  const live = latestLiveChecks({
    statuses: [
      status("legacy", "failure", "2026-08-01T00:00:00Z"),
      status("legacy", "success", "2026-08-01T01:00:00Z"),
    ],
  });
  assert.equal(live.length, 1);
  assert.equal(live[0].gate, "pass");
});

test("pending required checks block", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, null, { status: "in_progress" })],
  });
  assert.equal(result.decision, "blocked");
  assert.match(result.blockers[0], /^pending:/);
});

test("unknown check conclusions produce unknown, never ready", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, "mystery")],
  });
  assert.equal(result.decision, "unknown");
});

test("incomplete policy or live evidence fails closed", () => {
  const completeness = evaluateRequiredCheckCompleteness({
    branchProtectionGraphqlComplete: true,
    matchingClassicRuleCount: 0,
    classicProtectionReadable: false,
    activeRulesComplete: false,
    checkRunsComplete: true,
    statusesComplete: true,
  });
  const result = evaluateRequiredChecks({
    evidenceComplete: completeness.complete,
    incompleteReasons: completeness.reasons,
  });
  assert.equal(result.decision, "unknown");
  assert.ok(result.unknowns.includes("active_rules_incomplete"));
});

test("strict required checks block an out-of-date branch", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, "success")],
    strict: true,
    mergeStateStatus: "BEHIND",
  });
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.includes("strict_branch_out_of_date"));
});

test("observed mode blocks visible failing checks without inventing names", () => {
  const result = evaluateRequiredChecks({
    descriptors: [],
    checkRuns: [run("optional-but-failing", 11, "failure")],
  });
  assert.equal(result.mode, "observed");
  assert.equal(result.decision, "blocked");
});

test("classic checks supersede the deprecated mirrored contexts list", () => {
  const policy = normalizeRequiredChecks({
    classicRequiredStatusChecks: {
      contexts: ["build"],
      checks: [{ context: "build", app_id: 11 }],
    },
  });
  assert.deepEqual(
    policy.descriptors.map(({ context, appId }) => ({ context, appId })),
    [{ context: "build", appId: 11 }],
  );
});

test("app id -1 explicitly allows any source", () => {
  const policy = normalizeRequiredChecks({
    classicRequiredStatusChecks: {
      checks: [{ context: "build", app_id: -1 }],
    },
  });
  assert.equal(policy.descriptors[0].appId, null);
});

test("an app-bound commit status with unverifiable source stays unknown", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "legacy", appId: 11, sources: [] }],
    statuses: [status("legacy", "success")],
  });
  assert.equal(result.decision, "unknown");
  assert.equal(result.requiredStatus[0].sourceIdentityUnverifiable, true);
});

test("known failures stay blocked when another source is incomplete", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: [run("build", 11, "failure")],
    evidenceComplete: false,
    incompleteReasons: ["active_rules_incomplete"],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.complete, false);
});

test("test merge evidence is authoritative when GitHub has emitted checks on it", () => {
  const headOid = "a".repeat(40);
  const testMergeOid = "b".repeat(40);
  const selected = selectAuthoritativeCheckEvidence({
    headOid,
    testMergeOid,
    headCheckRuns: [run("build", 11, "success")],
    headStatuses: [],
    testMergeCheckRuns: [run("build", 11, "failure")],
    testMergeStatuses: [],
    headEvidenceComplete: true,
    testMergeEvidenceComplete: true,
  });
  assert.equal(selected.sha, testMergeOid);
  assert.equal(selected.reason, "test_merge_has_status");
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: selected.checkRuns,
    statuses: selected.statuses,
    evidenceComplete: selected.complete,
    incompleteReasons: selected.incompleteReasons,
  });
  assert.equal(result.decision, "blocked");
});

test("UNKNOWN mergeability ignores a present test-merge SHA", () => {
  const headOid = "a".repeat(40);
  const testMergeOid = "b".repeat(40);
  const selected = selectAuthoritativeCheckEvidence({
    headOid,
    testMergeOid,
    mergeStateStatus: "UNKNOWN",
    headCheckRuns: [run("build", 11, "failure")],
    headStatuses: [],
    testMergeCheckRuns: [run("build", 11, "success")],
    testMergeStatuses: [],
    headEvidenceComplete: true,
    testMergeEvidenceComplete: true,
  });
  assert.equal(selected.sha, headOid);
  assert.equal(selected.reason, "test_merge_ignored_mergeability_unknown");
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: [] }],
    checkRuns: selected.checkRuns,
    statuses: selected.statuses,
    evidenceComplete: selected.complete,
    incompleteReasons: selected.incompleteReasons,
  });
  assert.equal(result.decision, "blocked");
});

test("CLEAN mergeability still prefers a present test-merge SHA", () => {
  const headOid = "a".repeat(40);
  const testMergeOid = "b".repeat(40);
  const selected = selectAuthoritativeCheckEvidence({
    headOid,
    testMergeOid,
    mergeStateStatus: "CLEAN",
    headCheckRuns: [run("build", 11, "success")],
    headStatuses: [],
    testMergeCheckRuns: [run("build", 11, "failure")],
    testMergeStatuses: [],
    headEvidenceComplete: true,
    testMergeEvidenceComplete: true,
  });
  assert.equal(selected.sha, testMergeOid);
  assert.equal(selected.reason, "test_merge_has_status");
});

test("snapshot capture passes GraphQL mergeStateStatus into check selection", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../scripts/ship-gate-snapshot.mjs", import.meta.url)),
    "utf8",
  );
  assert.match(
    source,
    /selectAuthoritativeCheckEvidence\(\{[\s\S]*mergeStateStatus:/,
  );
});

test("head evidence is authoritative only when the test merge has no status evidence", () => {
  const headOid = "a".repeat(40);
  const selected = selectAuthoritativeCheckEvidence({
    headOid,
    testMergeOid: "b".repeat(40),
    headCheckRuns: [run("build", 11, "success")],
    headStatuses: [],
    testMergeCheckRuns: [],
    testMergeStatuses: [],
    headEvidenceComplete: true,
    testMergeEvidenceComplete: true,
  });
  assert.equal(selected.sha, headOid);
  assert.equal(selected.reason, "test_merge_has_no_status");
  assert.equal(selected.complete, true);
});

test("incomplete test merge evidence cannot silently fall back to the head", () => {
  const selected = selectAuthoritativeCheckEvidence({
    headOid: "a".repeat(40),
    testMergeOid: "b".repeat(40),
    headCheckRuns: [run("build", 11, "success")],
    headStatuses: [],
    testMergeCheckRuns: [],
    testMergeStatuses: [],
    headEvidenceComplete: true,
    testMergeEvidenceComplete: false,
  });
  assert.equal(selected.complete, false);
  assert.equal(selected.sha, "b".repeat(40));
  assert.equal(selected.reason, "test_merge_evidence_incomplete");
  assert.ok(selected.incompleteReasons.includes("test_merge_check_evidence_incomplete"));
});

test("an app-bound green check run is blocked by a same-name failing commit status", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: ["ruleset"] }],
    checkRuns: [run("build", 11, "success")],
    statuses: [status("build", "failure")],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.requiredStatus[0].gate, "fail");
  assert.equal(result.requiredStatus[0].sourceIdentityUnverifiable, false);
  assert.equal(result.requiredStatus[0].matches.length, 2);
});

test("an app-bound green check run is blocked by a same-name pending commit status", () => {
  const result = evaluateRequiredChecks({
    descriptors: [{ context: "build", appId: 11, sources: ["ruleset"] }],
    checkRuns: [run("build", 11, "success")],
    statuses: [status("build", "pending")],
  });
  assert.equal(result.decision, "blocked");
  assert.equal(result.requiredStatus[0].gate, "pending");
});
