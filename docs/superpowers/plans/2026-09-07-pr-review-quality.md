# PR Review Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve PR writing, bot-finding triage, code-quality visibility, and blast-radius reporting without duplicating GitHub Delivery's existing review engines.

**Architecture:** Keep `pr-description.md`, Spec/Standards, design-quality, semantic propagation, and safety-invariant as the owning mechanisms. Add only one small finding-triage contract and wire clearer outputs into existing full-review/fix-pr-bots/publication references. Preserve draft-only initial PR creation and all existing mutation/evidence gates.

**Tech Stack:** Markdown policy/reference contracts, Node.js `node:test` contract tests, GitHub Actions repository checks.

**Spec:** `docs/superpowers/specs/2026-09-07-pr-review-quality-design.md`

## Global Constraints

- Keep package version exactly `1.4.7`.
- Extend only the existing `1.4.7` changelog entry.
- Do not add a second code-review or blast-radius subsystem.
- Do not weaken draft-only initial routed PR creation.
- Do not merge, tag, create a GitHub Release, publish npm, or transition the PR to ready-for-review.

---

### Task 1: Pin the new review contracts with RED tests

**Files:**
- Create: `tests/unit/pr-review-quality-contracts.test.mjs`

**Interfaces:**
- Consumes: current reference files on `main`.
- Produces: executable assertions for title/body policy, two-dimensional bot triage, code-quality output, blast-radius output, and 1.4.7 version stability.

- [ ] **Step 1: Write the failing contract test**

Assert that the final references contain:

```js
assert.match(prDescription, /recent merged PRs/i);
assert.match(prDescription, /problem|context/i);
assert.doesNotMatch(defaultBody, /## Validation/);
assert.match(triage, /confirmed \| false-positive \| stale \| unproven/);
assert.match(triage, /must-fix \| worth-fixing \| decline \| human-decision/);
assert.match(fullReview, /Code quality/);
assert.match(fullReview, /Blast radius/);
assert.match(reviewsPolicy, /review-finding-triage\.md/);
assert.match(packageJson, /"version": "1\.4\.7"/);
```

- [ ] **Step 2: Run the test and verify RED**

Run through the repository's canonical Node test path. Expected failure: the new title/body, finding-triage, and visible output contracts do not yet exist.

- [ ] **Step 3: Commit the test-only RED state**

Commit message: `test: pin PR review quality contracts`.

### Task 2: Improve PR title/body policy

**Files:**
- Modify: `references/pr-description.md`
- Test: `tests/unit/pr-review-quality-contracts.test.mjs`

**Interfaces:**
- Consumes: current media-preservation and final-head reconciliation policy.
- Produces: concise title/body authoring rules while keeping existing safety invariants.

- [ ] **Step 1: Add title selection rules**

Require repository conventions plus recent merged PRs/Git history when available, and prefer resulting effect over implementation mechanics.

- [ ] **Step 2: Replace the mandatory validation-heavy default body**

Default body should be context/problem + one to three result bullets + canonical issue link. Validation, review notes, limitations, Mermaid, snippets, before/after media, or benchmarks are optional only when useful.

- [ ] **Step 3: Preserve safety boundaries**

Keep live-body newline verification, issue-link preservation, protected-media checks, final-head reconciliation, and draft-only initial PR lifecycle unchanged.

- [ ] **Step 4: Run focused contract tests**

Expected: title/body assertions pass while remaining new triage/output assertions still fail until later tasks.

- [ ] **Step 5: Commit**

Commit message: `docs: improve PR title and body guidance`.

### Task 3: Add evidence-backed bot finding triage

**Files:**
- Create: `references/review-finding-triage.md`
- Modify: `references/policy/reviews.md`
- Modify: `references/fix-pr-bots.md`
- Modify: `references/full-review-pr.md`
- Test: `tests/unit/pr-review-quality-contracts.test.mjs`

**Interfaces:**
- Produces: canonical `Truth` and `Action` classifications for review findings.

- [ ] **Step 1: Define the two dimensions**

Truth is exactly `confirmed | false-positive | stale | unproven`; action is exactly `must-fix | worth-fixing | decline | human-decision`.

- [ ] **Step 2: Define evidence thresholds**

`must-fix` requires a concrete Bug/Security/Spec/repository-standard/compatibility/lifecycle/persistence/material-maintenance consequence. Material external API/runtime/dependency claims require source or executable verification against what is actually shipped.

- [ ] **Step 3: Define decline/scope-creep controls**

Taste-only alternatives, speculative refactors, unsupported hypotheticals, and already-tool-enforced style are not reasons to mutate code.

- [ ] **Step 4: Compose the contract**

Update review policy, `fix-pr-bots`, and full review to classify bot findings before fix/decline/resolve decisions.

- [ ] **Step 5: Run focused tests and commit**

Commit message: `docs: classify bot findings before action`.

### Task 4: Surface code quality and blast radius

**Files:**
- Modify: `references/spec-standards-review.md`
- Modify: `references/full-review-pr.md`
- Modify: `references/comment-depth.md`
- Test: `tests/unit/pr-review-quality-contracts.test.mjs`

**Interfaces:**
- Consumes: existing design-quality, semantic-propagation, and safety-invariant results.
- Produces: clear `Code quality` and `Blast radius` verdict fields without new review engines.

- [ ] **Step 1: Expose Code quality**

Keep Spec and Standards independent, but summarize applicable design-quality/smell observations separately as advisory unless another axis makes them binding.

- [ ] **Step 2: Expose Blast radius**

Report local/non-local scope, affected concepts, safety invariant/proof level where applicable, confirmed risks, cleared risks, and unproven assumptions. `n/a` requires a concrete local-only reason.

- [ ] **Step 3: Update public verdict templates**

Add concise Code quality and Blast radius lines to the TLDR/full verdict without turning GitHub comments into essays.

- [ ] **Step 4: Run focused tests and commit**

Commit message: `docs: surface code quality and blast radius`.

### Task 5: Release metadata and final verification

**Files:**
- Modify: `CHANGELOG.md`
- Verify unchanged: `package.json`

**Interfaces:**
- Produces: complete unreleased 1.4.7 release metadata for this follow-up.

- [ ] **Step 1: Extend the existing 1.4.7 changelog section**

Add concise bullets for PR writing guidance, evidence-backed bot triage, and surfaced code-quality/blast-radius review output. Do not create another version heading.

- [ ] **Step 2: Verify package version remains 1.4.7**

- [ ] **Step 3: Run canonical repository checks**

Require current-head CI, CodeQL, and Dependency Review success.

- [ ] **Step 4: Open a draft PR against `main`**

Use a concise effect-focused title/body that follows the new policy. Do not include routine validation history in the body.

- [ ] **Step 5: Inspect bot feedback and final diff**

Classify any bot finding by Truth + Action before changing code. Review code/reference quality and blast radius of this PR itself.
