# Audit Generation 10 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every generation-10 audit finding while preserving the hard contract that `authorityMode=off` never invokes Windows Hello.

**Architecture:** Keep mutation-mode routing and OS-backed trusted authority as separate layers. Off mode explicitly disables the Authority-host layer and must not pretend raw request booleans are trusted provenance; high-assurance/all remain unchanged. Close the remaining false-green and static-analysis gaps with fail-closed validators and focused regressions.

**Tech Stack:** Node.js ES modules, node:test, GitHub CLI/GitHub Actions, C#/.NET Windows Authority host, Markdown policy/docs.

**Spec:** `docs/superpowers/specs/2026-08-24-audit-generation-10-remediation-design.md`

## Global Constraints

- `authorityMode=off` must never invoke Windows Hello or require an Authority-host acceptance.
- `high-assurance` and `all` retain scoped trusted-authority enforcement.
- Do not broaden mutation profiles, bypass expected-head checks, stack gates, ownership checks, idempotency, review-thread policy, or publication verification.
- Every finding gets a focused RED regression before the production fix.
- Final acceptance requires canonical `npm run check`, repository-security checks, Windows authority build/self-test, CodeQL, Dependency Review, and exact-head re-review.

---

### Task 1: Off-mode authority semantics

**Files:**
- Modify: `scripts/lib/authority-grant.mjs`
- Modify: `scripts/lib/mutation-execution-context.mjs`
- Modify: `scripts/lib/mutation-policy.mjs`
- Modify: `references/mutation-modes.md`
- Test: `tests/unit/authority-mode-enforcement.test.mjs`
- Test: `tests/unit/mutation-execution-context.test.mjs`

**Interfaces:**
- `classifyAuthority(...)` must not promote raw request booleans to trusted provenance when no grant verifies.
- Off-mode execution receives an explicit policy option indicating trusted authority is disabled by user configuration; no Authority host/redeemer is invoked.
- `authorizeMutation(...)` accepts that option only for Off mode and still enforces the selected profile/action allowlist.

- [ ] Add failing tests proving raw `explicitInstruction:true` is not independently trusted and Off never calls the Authority host.
- [ ] Run focused tests and capture RED.
- [ ] Implement Off-mode policy provenance without Windows Hello.
- [ ] Run focused tests to GREEN.

### Task 2: Required probe trigger-file coverage

**Files:**
- Modify: `scripts/lib/probe-evidence.mjs`
- Test: `tests/unit/probe-evidence.test.mjs`

**Interfaces:**
- `validateProbeEvidenceRecord(record, {triggerFiles, required})` rejects `clean` required evidence unless `files` is a duplicate-free exact set of all trigger files.

- [ ] Add failing tests for empty, partial, duplicate, and extra-file clean evidence.
- [ ] Run focused test to RED.
- [ ] Implement exact required-trigger coverage validation.
- [ ] Run focused test to GREEN.

### Task 3: Classic branch-pattern fail-closed parity

**Files:**
- Modify: `scripts/lib/snapshot-evaluators.mjs`
- Test: `tests/unit/classic-branch-protection-safety.test.mjs`

**Interfaces:**
- `patternMatchesBranch(pattern, branch)` returns a boolean only for the proven GitHub-compatible subset.
- Ambiguous/unsupported pattern syntax is surfaced as incomplete policy evidence so merge readiness becomes `unknown`, not an incorrect non-match.

- [ ] Add failing parity/fail-closed fixtures for `^`, backslash forms, dot-leading names, bracket classes, `*`, `?`, and `**`.
- [ ] Run focused test to RED.
- [ ] Replace permissive approximation with strict subset parser and propagate unsupported syntax as unknown policy evidence.
- [ ] Run focused test to GREEN.

### Task 4: Router prompt-injection boundary

**Files:**
- Modify: `scripts/lib/skill-router.mjs`
- Test: `tests/unit/skill-router.test.mjs`
- Test: `tests/evals/behavioural-adversarial-cases.json` when schema permits a direct paired fixture.

**Interfaces:**
- Attributed issue bodies/descriptions and generic repository-provided text are stripped from authority-bearing routing analysis.
- A genuine user instruction after the attributed section remains routable only when it is syntactically outside the untrusted attribution span.

- [ ] Add failing issue-body/description injection tests plus neutral controls.
- [ ] Run focused test to RED.
- [ ] Extend attribution stripping using channel-oriented parsing rather than a single new phrase special case.
- [ ] Run focused test to GREEN.

### Task 5: Named GraphQL mutation detection

**Files:**
- Modify: `scripts/lib/mutation-boundary-security.mjs`
- Test: `tests/unit/mutation-boundary-security.test.mjs`

**Interfaces:**
- Detect GraphQL mutation operation headers with optional operation names and variables.
- Extract the first top-level mutation field for registered-mutation checks.

- [ ] Add failing tests for `mutation UpdateThing(...) { ... }` outside and inside privileged mutation files.
- [ ] Run focused test to RED.
- [ ] Implement named/anonymous operation detection.
- [ ] Run focused test to GREEN.

### Task 6: Merge review-thread TOCTOU hardening

**Files:**
- Modify: `scripts/merge-pr-driver.mjs`
- Modify as needed: `scripts/lib/workflow-security.mjs`
- Modify: `references/merge-pr.md`
- Test: merge-driver unit/integration tests that exercise final recapture and live-policy evidence.

**Interfaces:**
- Immediately before merge authority/broker execution, recapture review threads against the same head/base decision.
- Automated merge requires provable active conversation-resolution enforcement with no bypass evidence gap; otherwise fail closed.

- [ ] Add failing race fixture where a thread appears after the earlier ship gate.
- [ ] Add failing fixture for unproven/bypassable conversation-resolution enforcement.
- [ ] Run focused tests to RED.
- [ ] Implement final thread recapture + enforcement proof gate.
- [ ] Run focused tests to GREEN.

### Task 7: Behavioral-eval trusted provenance

**Files:**
- Modify: `scripts/lib/behavioural-evals.mjs`
- Modify: `scripts/compare-behavioural-evals.mjs`
- Modify: `references/behavioural-evaluations.md`
- Test: `tests/unit/behavioural-evals.test.mjs`

**Interfaces:**
- Existing canonical transcript hash remains integrity evidence.
- Add explicit provenance trust classification; unsigned/local packs are diagnostic-only and cannot be accepted as trusted gating evidence.
- Attested evidence binds run identity plus canonical transcript hash and is the only path to `trusted:true`.

- [ ] Add failing tests showing a fabricated self-consistent sidecar cannot claim trusted gating status.
- [ ] Run focused test to RED.
- [ ] Implement trust classification and gating behavior without adding network dependencies to unit tests.
- [ ] Run focused test to GREEN.

### Task 8: Canonical audit ledger and final verification

**Files:**
- Modify: `github-delivery-audit-state.json`
- Modify: `CHANGELOG.md`

- [ ] Record generation 10 baseline/head, findings, dispositions, and remediation PR reference without marking anything fixed before exact-head verification.
- [ ] Run all focused tests.
- [ ] Run canonical `npm run check` in CI.
- [ ] Run Windows authority build/self-test, repository policy/security, CodeQL, Dependency Review, and Windows rewrite baseline.
- [ ] Perform a fresh exact-head bug/security/spec review.
- [ ] If any finding remains, return to its task and repeat RED/GREEN + exact-head validation.
- [ ] Open/update the PR body with exact verification evidence and the explicit Off-mode no-Windows-Hello acceptance statement.
