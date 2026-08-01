# Snapshot-Driven Ship Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three stacked PRs that make all gates consume one validated evidence snapshot, add one final ship decision, and require feedback-specific resolution records.

**Architecture:** Shared pure evaluators sit behind existing CLI commands. Snapshot mode reads and validates a versioned JSON envelope without calling GitHub; live mode remains for compatibility. A composite gate combines evaluator decisions with blocked-over-unknown precedence, and feedback resolution uses exact feedback keys plus verified PR commits.

**Tech Stack:** Node.js 20+, ES modules, built-in `node:test`, GitHub CLI for live capture only.

## Global Constraints

- No runtime dependencies.
- Snapshot mode performs zero GitHub CLI calls.
- Invalid, stale, mismatched, or incomplete evidence exits `2`.
- Preserve live CLI interfaces while adding `--snapshot FILE` and optional `--expected-head SHA`.
- Keep CODEOWNERS advisory.
- Run all tests and syntax checks on Node.js 20 and 22 across Ubuntu, Windows, and macOS.

---

### Task 1: Snapshot validation and evaluator contracts

**Files:**
- Create: `scripts/lib/snapshot-input.mjs`
- Create: `scripts/lib/snapshot-evaluators.mjs`
- Create: `tests/unit/snapshot-consumers.test.mjs`

**Interfaces:**
- Produces: `parseSnapshotGateArgs(argv, usage)`, `readValidatedSnapshot(options)`, `validateSnapshot(options)`.
- Produces: `evaluateRequiredChecksSnapshot(snapshot)`, `evaluateReviewPolicySnapshot(snapshot)`, `evaluateReviewThreadsSnapshot(snapshot)`, `evaluateCodeownersSnapshot(snapshot)`, `evaluateWakeSnapshot(snapshot)`.

- [ ] Write failing tests for identity, head consistency, age, completeness, and evaluator results.
- [ ] Run the focused test and confirm failures are caused by missing modules.
- [ ] Implement the validation and evaluator modules.
- [ ] Run the focused test and the existing suite.

### Task 2: Capture all evaluator evidence

**Files:**
- Modify: `scripts/ship-gate-snapshot.mjs`
- Modify: `tests/unit/snapshot-schema.test.mjs`

**Interfaces:**
- Adds: `evidence.policy`, `evidence.workflowCoverage`, `evidence.viewer`, and `evidence.codeowners.errors`.
- Adds corresponding required source-status entries.

- [ ] Write failing schema tests for the added evidence contract.
- [ ] Run the focused tests and confirm the expected failure.
- [ ] Extend capture without changing schema version 1 compatibility.
- [ ] Run syntax checks and all tests.

### Task 3: Wire individual gates to snapshot mode

**Files:**
- Modify: `scripts/required-checks.mjs`
- Modify: `scripts/pr-policy-gate.mjs`
- Modify: `scripts/review-threads.mjs`
- Modify: `scripts/codeowners-for-pr.mjs`
- Modify: `scripts/watch-wake-gate.mjs`
- Create: `tests/unit/snapshot-cli.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Adds CLI: `OWNER/REPO PR --snapshot FILE [--expected-head SHA] [--max-age-seconds N]`.

- [ ] Write CLI tests that remove `gh` from `PATH` and invoke every gate in snapshot mode.
- [ ] Confirm the tests fail before the CLI wiring exists.
- [ ] Add early snapshot-mode branches to each gate.
- [ ] Run all checks and commit PR 5.

### Task 4: Composite ship decision

**Files:**
- Create: `scripts/lib/ship-gate-policy.mjs`
- Create: `scripts/ship-gate.mjs`
- Create: `tests/unit/ship-gate-policy.test.mjs`
- Create: `tests/unit/ship-gate-cli.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `combineShipGateResults({ snapshot, requiredChecks, reviewPolicy, reviewThreads, wake, codeowners })`.
- Adds CLI: `node scripts/ship-gate.mjs OWNER/REPO PR [--snapshot FILE]`.

- [ ] Write failing policy tests for ready, blocked, unknown, and advisory-only cases.
- [ ] Implement the pure combiner.
- [ ] Write failing CLI tests for snapshot mode and one-capture live orchestration.
- [ ] Implement the CLI, run all checks, and commit PR 6.

### Task 5: Feedback-specific resolution records

**Files:**
- Modify: `scripts/lib/watch-feedback.mjs`
- Modify: `scripts/watch-wake-gate.mjs`
- Modify: `scripts/lib/snapshot-evaluators.mjs`
- Modify: `tests/unit/gate-fixtures.test.mjs`
- Create: `tests/unit/feedback-resolution.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseFeedbackResolution(comment)`, `evaluateFeedbackResolutions({ feedback, commits })`.
- Changes: `findUnaddressedFeedback` clears only exact feedback keys with valid resolution records.

- [ ] Write failing tests for exact resolution, unrelated commits, wrong keys, missing commits, ordering, merge commits, and ambiguous short SHAs.
- [ ] Confirm the focused tests fail against the old later-commit heuristic.
- [ ] Implement parsing and validation, then update both live and snapshot wake evaluation.
- [ ] Run all checks and commit PR 7.
