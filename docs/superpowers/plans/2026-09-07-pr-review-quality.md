# PR Review Quality Implementation Plan

> **For agentic workers:** execute this plan task-by-task and keep verification bound to the current PR head.

**Goal:** Improve PR writing, bot-finding triage, code-quality visibility, and blast-radius reporting without duplicating GitHub Delivery's existing review engines.

**Architecture:** Keep `pr-description.md`, Spec/Standards, design-quality, semantic propagation, and safety-invariant as the owning mechanisms. Add two focused companions: `review-finding-triage.md` for Truth/Action decisions and `review-outcome.md` for visible Code quality / Blast radius conclusions. Keep the global `reviews` policy as a thin router so broad workflow packets remain inside the repository context budget.

**Spec:** `docs/superpowers/specs/2026-09-07-pr-review-quality-design.md`

## Global constraints

- Keep package version exactly `1.4.7`.
- Extend only the existing `1.4.7` changelog entry.
- Do not add a second code-review or blast-radius subsystem.
- Do not weaken draft-only initial routed PR creation.
- Do not merge, tag, create a GitHub Release, publish npm, or transition the PR to ready-for-review.

### Task 1: Pin the contracts with RED evidence

**Files:** `tests/unit/pr-review-quality-contracts.test.mjs`

- [x] Add a test-only contract covering concise title/body guidance, Truth/Action bot triage, Code quality / Blast radius composition, and 1.4.7 version stability.
- [x] Verify RED on the test-only head before production/reference changes. The expected failure was the missing new PR-writing contract.
- [x] Keep the final test bound to the architectural contract rather than requiring duplicated wording inside giant workflow files.

### Task 2: Improve PR title/body policy

**Files:** `references/pr-description.md`

- [x] Require repository conventions, recent merged PRs, and Git history where available before materially choosing/revising a title.
- [x] Prefer the resulting effect / why it matters over implementation mechanics.
- [x] Make the default body a short context/problem paragraph plus one to three result bullets and an issue link when one exists.
- [x] Make Mermaid, snippets, before/after media, benchmarks, risk/compatibility notes, and unusual validation evidence optional when they improve review comprehension.
- [x] Remove routine CI/TDD/exact-head/file-count output from the default body while keeping that evidence mandatory in the workflow where applicable.
- [x] Preserve protected media, issue-link, live-newline, final-head, and draft-only lifecycle invariants.

### Task 3: Separate finding truth from action

**Files:** `references/review-finding-triage.md`, `references/fix-pr-bots.md`, `references/policy/reviews.md`

- [x] Define Truth as `confirmed | false-positive | stale | unproven`.
- [x] Define Action as `must-fix | worth-fixing | decline | human-decision`.
- [x] Require concrete correctness/security/spec/standard/compatibility/lifecycle/persistence/material-maintenance evidence for `must-fix`.
- [x] Require material dependency/runtime/API claims to be checked against the actual shipped/pinned source or an executable probe when practical.
- [x] Reject taste-only alternatives, speculative refactors, unsupported hypotheticals, and tooling-accepted style as automatic reasons to mutate code.
- [x] Compose the decision contract into bot-fix and the existing review policy without duplicating it in every workflow.

### Task 4: Surface Code quality and Blast radius

**Files:** `references/spec-standards-review.md`, `references/review-outcome.md`, `references/policy/reviews.md`

- [x] Keep Spec and Standards as the existing independent authority axes.
- [x] Expose `Code quality` as the compact advisory result of existing code-smell/design-quality/type-evidence lenses.
- [x] Expose `Blast radius` from existing semantic-propagation plus safety-invariant evidence; do not add another reviewer.
- [x] Report local/non-local scope, affected concepts, safety invariant/proof, confirmed/cleared risks, and material unproven assumptions.
- [x] Keep a material invariant below `Executed` explicitly `unproven` unless the governing review records why executable proof is impractical and gates the result accordingly.
- [x] Bind the detailed outcome contract through a thin review-policy companion reference instead of expanding `full-review-pr.md` / `comment-depth.md` and blowing the shared policy budget.

### Task 5: Release metadata and final verification

**Files:** `CHANGELOG.md`; verify unchanged `package.json`

- [ ] Extend the existing 1.4.7 changelog section with this follow-up; do not create a second 1.4.7 heading.
- [ ] Verify `package.json` remains exactly `1.4.7`.
- [ ] Refresh PR #430 title/body against the final writing policy without routine validation history.
- [ ] Review the final diff for code/reference quality and blast radius; classify any bot findings by Truth + Action before changing code.
- [ ] Require fresh current-head CI, CodeQL, and Dependency Review success.
- [ ] Keep PR #430 draft, open, and unmerged.
