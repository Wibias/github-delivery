# Ship-gate unknown merge state Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop ship-gate from returning `ready` when GitHub mergeability is `UNKNOWN`, missing, `DRAFT`, or an unrecognised enum, and stop treating a stale test-merge SHA as the check oracle in that case.

**Architecture:** Keep the existing combiner and check-selector. Replace the `BLOCKED`-only merge-state special case with an explicit allowlist. Pass GraphQL `mergeStateStatus` into `selectAuthoritativeCheckEvidence` so uncomputed mergeability uses HEAD checks.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-21-ship-gate-unknown-merge-state-design.md`

## Global Constraints

- Branch from `origin/main` (`0868e9e`). Do not implement on `codex/v1.0.0-docs`.
- GD-AUDIT-058 only. Do not bundle 050, 071, 072, 051, or docs-package work.
- No merge-driver or broker hard-stop beyond the existing `ready` requirement.
- No merge-boundary fingerprint change.
- No live `gh pr merge` probe of GitHub `UNKNOWN`.
- Do not commit unless the user asks.
- If a test shows `CLEAN` plus REST `mergeable` `UNKNOWN`, stop and ask. Do not add a second combiner oracle.

## File map

- Modify: `scripts/lib/ship-gate-policy.mjs` — combiner merge-state table
- Modify: `scripts/lib/required-checks-policy.mjs` — ignore test-merge SHA while mergeability is uncomputed
- Modify: `scripts/ship-gate-snapshot.mjs` — pass `mergeStateStatus` into the selector
- Modify: `tests/unit/audit-remediation.test.mjs` — combiner cases
- Modify: `tests/unit/required-checks-policy.test.mjs` — selector cases
- No new files besides this plan and the already-written spec

---

### Task 1: Combiner fail-closed on uncomputed merge state

**Files:**
- Modify: `tests/unit/audit-remediation.test.mjs` (after the existing BLOCKED test around line 123)
- Modify: `scripts/lib/ship-gate-policy.mjs:89-94`

**Interfaces:**
- Consumes: `combineShipGateResults({ snapshot, ... })` as today
- Produces: `unknowns` may include `policy:github_merge_state_unknown` in addition to existing `policy:github_merge_state_blocked`

- [ ] **Step 1: Write the failing combiner tests**

Keep the existing BLOCKED test. Insert after it:

```js
test("an unexplained GitHub UNKNOWN merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "UNKNOWN" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.equal(gate.decision, "unknown");
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("a missing GitHub merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: {}, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("an empty GitHub merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("an unrecognised GitHub merge state never becomes ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "FUTURE_STATE" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("a DRAFT GitHub merge state never becomes ready even when isDraft is false", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: {
      pullRequest: { mergeStateStatus: "DRAFT", isDraft: false },
      activeRules: [],
    },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, false);
  assert.ok(gate.unknowns.includes("policy:github_merge_state_unknown"));
});

test("a CLEAN GitHub merge state can still be ready", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "CLEAN" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.ready, true);
  assert.equal(gate.decision, "ready");
});

test("DIRTY merge state is left to wake and does not add a combiner unknown", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "DIRTY" }, activeRules: [] },
  };
  const gate = combineShipGateResults(readyShipInput(snapshot));
  assert.equal(gate.decision, "ready");
  assert.equal(
    gate.unknowns.includes("policy:github_merge_state_unknown"),
    false,
  );
  assert.equal(
    gate.unknowns.includes("policy:github_merge_state_blocked"),
    false,
  );
});

test("failing required checks stay blocked when GitHub merge state is UNKNOWN", () => {
  const snapshot = {
    headOid: HEAD,
    evidence: { pullRequest: { mergeStateStatus: "UNKNOWN" }, activeRules: [] },
  };
  const gate = combineShipGateResults({
    ...readyShipInput(snapshot),
    requiredChecks: {
      decision: "blocked",
      complete: true,
      blockers: ["fail:build"],
      unknowns: [],
    },
  });
  assert.equal(gate.ready, false);
  assert.equal(gate.decision, "blocked");
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test tests/unit/audit-remediation.test.mjs`

Expected: FAIL on the new UNKNOWN / missing / empty / unrecognised / DRAFT cases because `gate.ready` is still `true`. CLEAN and BLOCKED keep passing. DIRTY currently passes this new assertion (ready, no combiner unknown) — that is intended and must stay green.

- [ ] **Step 3: Implement the combiner table**

In `scripts/lib/ship-gate-policy.mjs`, add constants next to `UNDERSTOOD_ACTIVE_RULE_TYPES` and replace the BLOCKED-only block:

```js
const MERGE_STATES_READY = new Set(["CLEAN", "UNSTABLE", "HAS_HOOKS"]);
const MERGE_STATES_WAKE = new Set(["DIRTY", "BEHIND", "CONFLICTING"]);

function applyMergeStateUnknowns(snapshot, unknowns) {
  const mergeStateStatus = String(
    snapshot?.evidence?.pullRequest?.mergeStateStatus || "",
  ).toUpperCase();
  if (mergeStateStatus === "BLOCKED") {
    unknowns.push("policy:github_merge_state_blocked");
    return;
  }
  if (
    MERGE_STATES_READY.has(mergeStateStatus) ||
    MERGE_STATES_WAKE.has(mergeStateStatus)
  ) {
    return;
  }
  unknowns.push("policy:github_merge_state_unknown");
}
```

Replace:

```js
  const mergeStateStatus = String(
    snapshot?.evidence?.pullRequest?.mergeStateStatus || "",
  ).toUpperCase();
  if (mergeStateStatus === "BLOCKED") {
    unknowns.push("policy:github_merge_state_blocked");
  }
```

with:

```js
  applyMergeStateUnknowns(snapshot, unknowns);
```

- [ ] **Step 4: Re-run combiner tests**

Run: `node --test tests/unit/audit-remediation.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit only if the user asks**

Do not commit in this task unless explicitly requested.

---

### Task 2: Ignore stale test-merge SHA while mergeability is uncomputed

**Files:**
- Modify: `tests/unit/required-checks-policy.test.mjs` (after the existing `test merge evidence is authoritative` test around line 202)
- Modify: `scripts/lib/required-checks-policy.mjs` (`selectAuthoritativeCheckEvidence`)
- Modify: `scripts/ship-gate-snapshot.mjs` (the `selectAuthoritativeCheckEvidence({...})` call around line 805)
- Modify: `tests/unit/audit-remediation.test.mjs` (one source-contract assertion, or add it in required-checks-policy.test.mjs)

**Interfaces:**
- Consumes: existing `selectAuthoritativeCheckEvidence({ headOid, testMergeOid, ... })`
- Produces: optional `mergeStateStatus` argument. When omitted, behaviour is unchanged. When `UNKNOWN`, empty, or outside `{BEHIND, BLOCKED, CLEAN, DIRTY, DRAFT, HAS_HOOKS, UNKNOWN, UNSTABLE}`, ignore `testMergeOid` and return HEAD evidence with `reason: "test_merge_ignored_mergeability_unknown"`.

- [ ] **Step 1: Write the failing selector tests**

Add to `tests/unit/required-checks-policy.test.mjs`:

```js
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
```

The existing omitted-`mergeStateStatus` test (`test merge evidence is authoritative when GitHub has emitted checks on it`) must keep passing without changes.

Add a source-contract test in the same file:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
```

If `required-checks-policy.test.mjs` does not already import `readFileSync` / `fileURLToPath`, add those imports at the top. Do not duplicate an import that already exists.

- [ ] **Step 2: Run selector tests and confirm RED**

Run: `node --test tests/unit/required-checks-policy.test.mjs`

Expected: FAIL because `selected.sha` is still the test-merge SHA and `reason` is `test_merge_has_status`. The snapshot source-contract test also fails until Step 4.

- [ ] **Step 3: Implement selector ignore**

In `scripts/lib/required-checks-policy.mjs`, add:

```js
const GRAPHQL_MERGE_STATE_STATUSES = new Set([
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
]);

function ignoreTestMergeForUncomputedMergeability(mergeStateStatus) {
  if (mergeStateStatus === undefined) return false;
  const status = String(mergeStateStatus || "").toUpperCase();
  if (!status || status === "UNKNOWN") return true;
  return !GRAPHQL_MERGE_STATE_STATUSES.has(status);
}
```

Change `selectAuthoritativeCheckEvidence` to accept `mergeStateStatus` and skip the test-merge branch when ignored:

```js
export function selectAuthoritativeCheckEvidence({
  headOid,
  testMergeOid = null,
  headCheckRuns = [],
  headStatuses = [],
  testMergeCheckRuns = [],
  testMergeStatuses = [],
  headEvidenceComplete = true,
  testMergeEvidenceComplete = true,
  mergeStateStatus,
} = {}) {
  const head = normalizedSha(headOid);
  if (!head) {
    return {
      complete: false,
      sha: null,
      reason: "head_sha_missing",
      checkRuns: [],
      statuses: [],
      incompleteReasons: ["authoritative_check_sha_missing"],
    };
  }

  const ignoreTestMerge = ignoreTestMergeForUncomputedMergeability(mergeStateStatus);
  const testMerge = ignoreTestMerge ? null : normalizedSha(testMergeOid);
  if (testMerge) {
    if (testMergeEvidenceComplete !== true) {
      return {
        complete: false,
        sha: testMerge,
        reason: "test_merge_evidence_incomplete",
        checkRuns: testMergeCheckRuns || [],
        statuses: testMergeStatuses || [],
        incompleteReasons: ["test_merge_check_evidence_incomplete"],
      };
    }
    const hasTestMergeEvidence =
      (testMergeCheckRuns || []).length > 0 || (testMergeStatuses || []).length > 0;
    if (hasTestMergeEvidence) {
      return {
        complete: true,
        sha: testMerge,
        reason: "test_merge_has_status",
        checkRuns: testMergeCheckRuns || [],
        statuses: testMergeStatuses || [],
        incompleteReasons: [],
      };
    }
  }

  if (headEvidenceComplete !== true) {
    return {
      complete: false,
      sha: head,
      reason: ignoreTestMerge
        ? "test_merge_ignored_mergeability_unknown"
        : testMerge
          ? "test_merge_has_no_status"
          : "head_only",
      checkRuns: headCheckRuns || [],
      statuses: headStatuses || [],
      incompleteReasons: ["head_check_evidence_incomplete"],
    };
  }

  return {
    complete: true,
    sha: head,
    reason: ignoreTestMerge
      ? "test_merge_ignored_mergeability_unknown"
      : testMerge
        ? "test_merge_has_no_status"
        : "head_only",
    checkRuns: headCheckRuns || [],
    statuses: headStatuses || [],
    incompleteReasons: [],
  };
}
```

Do not ignore test-merge for `CLEAN`, `UNSTABLE`, `HAS_HOOKS`, `BLOCKED`, `DIRTY`, `BEHIND`, or `DRAFT`.

- [ ] **Step 4: Pass mergeStateStatus from snapshot capture**

In `scripts/ship-gate-snapshot.mjs`, change the existing call to:

```js
  const selectedChecks = selectAuthoritativeCheckEvidence({
    headOid,
    testMergeOid,
    headCheckRuns: headCheckRuns.rows,
    headStatuses: headStatuses.rows,
    testMergeCheckRuns: testMergeCheckRuns.rows,
    testMergeStatuses: testMergeStatuses.rows,
    headEvidenceComplete: headCheckRuns.complete && headStatuses.complete,
    testMergeEvidenceComplete:
      testMergeCheckRuns.complete && testMergeStatuses.complete,
    mergeStateStatus: prEvidence.mergeStateStatus,
  });
```

- [ ] **Step 5: Re-run focused tests then the suite**

Run:

```
node --test tests/unit/required-checks-policy.test.mjs
node --test tests/unit/audit-remediation.test.mjs
npm test
```

Expected: PASS. `npm test` on Windows must not be treated as a 051 failure of `npm run check`.

- [ ] **Step 6: Commit only if the user asks**

Do not commit unless explicitly requested. Copy the spec and this plan onto the fix branch working tree if they are not already there.

---

## Self-review

- Spec combiner matrix: Task 1
- Spec test-merge SHA: Task 2
- Spec snapshot must pass `mergeStateStatus`: Task 2 source-contract + Step 4
- Spec CLEAN ready / BLOCKED unchanged / DIRTY left to wake / failing checks still blocked: Task 1
- No merge-driver, merge-boundary, 050/071/072, or live merge probe tasks
