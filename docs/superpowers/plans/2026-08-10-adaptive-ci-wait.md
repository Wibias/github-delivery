# Adaptive CI Wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded runner timing assumptions with a 30-second adaptive CI wait loop that starts with a 5-minute estimate and learns per-repository check durations.

**Architecture:** Keep timing/history logic pure and testable in `scripts/lib/ci-wait-timing.mjs`. Add `scripts/ci-wait.mjs` as the GitHub-facing loop that reruns the authoritative gate before every wait, reads current check runs, updates local timing history, and exits on readiness, head movement, unknown evidence, or non-CI blockers. Make `references/policy/ci.md` canonical for the behavior and remove runner-specific timing prose from `references/watch-pr.md`.

**Tech Stack:** Node.js ESM, built-in `node:test`, GitHub CLI invoked through existing bounded subprocess helpers, JSON user-state file.

## Global Constraints

- Default unknown CI duration estimate: exactly 5 minutes.
- Default CI polling interval: exactly 30 seconds.
- Five minutes is an estimate, not a timeout.
- No fixed poll-count or total-wait cap by default.
- Learned timing requires at least 3 successful samples.
- Keep at most 20 successful samples per repository/check identity.
- Never identify an OS/runner unless current GitHub evidence names it.
- `ship-gate.mjs` remains authoritative on every wake.

---

### Task 1: Timing and history model

**Files:**
- Create: `scripts/lib/ci-wait-timing.mjs`
- Test: `tests/unit/ci-wait-timing.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_CI_ESTIMATE_MS`, `DEFAULT_CI_POLL_MS`, `MIN_TIMING_SAMPLES`, `MAX_TIMING_SAMPLES`, `recordCompletedChecks(history, { repo, checkRuns })`, `estimateCheck(history, { repo, context, appId })`, `pendingCheckSummary({ repo, history, checkRuns, requiredContexts, nowMs })`, `loadTimingHistory(path)`, `saveTimingHistory(path, history)`.

- [ ] **Step 1: Write failing tests for the default estimate and learned estimate**

```js
assert.equal(estimateCheck({}, { repo: "o/r", context: "test", appId: 1 }).typicalMs, 300000);
assert.equal(estimateCheck(historyWithThreeSamples, { repo: "o/r", context: "test", appId: 1 }).source, "history");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/unit/ci-wait-timing.test.mjs`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement constants, history keying, median/p90 estimation, dedupe, and 20-sample retention**

Use check-run `id` as sample identity. Accept only successful completed checks with valid positive `started_at`/`completed_at` durations.

- [ ] **Step 4: Add failing tests for longest-running selection and evidence-only naming**

Create pending rows where `macos-test` started before `windows-test`; assert the summary selects `macos-test` solely from timestamps and returns the exact GitHub context without adding an OS label.

- [ ] **Step 5: Implement pending summary and compact duration formatting**

The summary must expose pending count, longest-running exact context, elapsed duration, estimate source, sample count, and whether elapsed exceeds the estimate.

- [ ] **Step 6: Add failing tests for history persistence and corrupt-cache fallback**

Use a temporary directory. A corrupt JSON file must load as an empty history. Saving must create the parent directory and write valid JSON.

- [ ] **Step 7: Implement persistence**

Write the history atomically with a temporary file followed by rename.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run: `node --test tests/unit/ci-wait-timing.test.mjs`
Expected: PASS.

### Task 2: CI wait driver

**Files:**
- Create: `scripts/ci-wait.mjs`
- Create: `scripts/lib/ci-wait-loop.mjs`
- Test: `tests/unit/ci-wait-loop.test.mjs`

**Interfaces:**
- Produces: `waitForCi({ inspect, sleep, pollMs, onPoll })` from `scripts/lib/ci-wait-loop.mjs`.
- Consumes: timing/history interfaces from Task 1.

- [ ] **Step 1: Write failing loop tests**

Test a sequence `wait -> wait -> ready` and assert `sleep` receives `[30000, 30000]`. Test 25 consecutive `wait` states before `ready` to prove there is no fixed 5-minute or iteration cutoff.

- [ ] **Step 2: Run the focused loop test and verify RED**

Run: `node --test tests/unit/ci-wait-loop.test.mjs`
Expected: FAIL because the loop module does not exist.

- [ ] **Step 3: Implement the minimal wait loop**

`inspect()` returns `{ action: "wait" | "ready" | "stop", ... }`. Call `onPoll(state)` on every inspection. Sleep only for `wait`.

- [ ] **Step 4: Run the focused loop test and verify GREEN**

Run: `node --test tests/unit/ci-wait-loop.test.mjs`
Expected: PASS.

- [ ] **Step 5: Implement CLI orchestration**

The CLI must:

```text
node scripts/ci-wait.mjs OWNER/REPO PR_NUMBER --workflow merge-pr --mutation-mode maintainer
```

On each inspection:

1. Run `scripts/ship-gate.mjs` with workflow/mutation-mode arguments.
2. Pin and compare the initial `headOid`.
3. Return `ready` when the gate is ready.
4. Return `stop` for unknown gate evidence.
5. Permit `wait` only when every blocker starts with `requiredChecks:pending:`.
6. Fetch all current check runs for `authoritativeCheckSha` through `gh api ... --paginate --slurp`.
7. Record successful completed checks into history.
8. Match pending required contexts from gate blocker names and build the progress summary.
9. Persist history and report the next check in 30 seconds.

There is no default total timeout.

- [ ] **Step 6: Syntax-check the CLI**

Run: `node --check scripts/ci-wait.mjs && node --check scripts/lib/ci-wait-loop.mjs`
Expected: exit 0.

### Task 3: Canonical policy and workflow prose

**Files:**
- Modify: `references/policy/ci.md`
- Modify: `references/watch-pr.md`
- Modify: `references/merge-pr.md`
- Test: `tests/unit/ci-wait-docs.test.mjs`

**Interfaces:**
- Policy rule: `GD-CI-009` defines adaptive CI wait timing.

- [ ] **Step 1: Write failing documentation contract tests**

Assert:

```js
assert.match(ciPolicy, /5 minutes/);
assert.match(ciPolicy, /30 seconds/);
assert.match(ciPolicy, /not a timeout/i);
assert.doesNotMatch(watchPr, /windows-latest.*12|12.*windows-latest/i);
assert.match(watchPr, /ci-wait\.mjs/);
assert.match(mergePr, /ci-wait\.mjs/);
```

- [ ] **Step 2: Run the focused docs test and verify RED**

Run: `node --test tests/unit/ci-wait-docs.test.mjs`
Expected: FAIL against the current runner-specific cadence text.

- [ ] **Step 3: Add `GD-CI-009` and update watch/merge instructions**

The policy must say:

- unknown timing starts at 5 minutes;
- poll every 30 seconds;
- 5 minutes is not a timeout;
- learned timing is per repo/check and requires evidence;
- runner labels are current-evidence-only;
- no fixed poll-count cap;
- every wake still runs the authoritative gate.

Replace the `windows-latest` 12-15 minute guidance in `watch-pr.md` with the adaptive rule. Add the driver to merge preflight when CI is pending.

- [ ] **Step 4: Run the focused docs test and verify GREEN**

Run: `node --test tests/unit/ci-wait-docs.test.mjs`
Expected: PASS.

### Task 4: Repository validation

**Files:**
- Modify: `package.json` only if needed to include syntax checks for the new CLI/library files.

- [ ] **Step 1: Run all new focused tests together**

Run: `node --test tests/unit/ci-wait-timing.test.mjs tests/unit/ci-wait-loop.test.mjs tests/unit/ci-wait-docs.test.mjs`
Expected: PASS with 0 failures.

- [ ] **Step 2: Run the complete unit suite**

Run: `npm test`
Expected: PASS with 0 failures.

- [ ] **Step 3: Run repository checks**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 4: Inspect the final diff**

Verify the diff contains only adaptive CI wait code, tests, policy/workflow documentation, and the design/plan docs. Confirm no runner-specific duration assumption remains.

- [ ] **Step 5: Commit and open a draft PR**

Branch: `agent/adaptive-ci-wait`

Commit/PR title: `fix(ci): make wait timing adaptive`

PR body must explain the root cause, 5-minute default estimate, 30-second polling, learned timing, current-evidence runner naming, and validation evidence.
