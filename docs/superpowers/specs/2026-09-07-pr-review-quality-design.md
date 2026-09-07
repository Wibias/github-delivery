# PR review quality design

## Status

Approved in chat on 2026-09-07. Implement as a follow-up for unreleased `1.4.7` from current `main` after PR #429.

## Problem

GitHub Delivery already has strong review machinery, but three parts of the reviewer experience are harder to use than they need to be:

1. PR titles and bodies are evidence-correct but often read like implementation inventories or review logs instead of concise explanations of why the change matters.
2. Bot findings are verified against source, but the workflow does not clearly separate whether a finding is true from whether changing code is the right action.
3. Code-quality and non-local blast-radius evidence exist across Spec/Standards, design-quality, semantic propagation, and safety-invariant review, but their conclusions are not surfaced clearly enough in PR review results.

## Design

### PR title and body

Keep `references/pr-description.md` as the canonical policy, but make it own both title and body quality.

- Before choosing a title, inspect repository title conventions, recent merged PRs, and Git history where available.
- Prefer a concise human-readable title that communicates the resulting effect or why it matters rather than internal implementation mechanics.
- Open the body with the problem/context and resulting behavior, not a file/commit inventory.
- Default to a short context paragraph plus one to three result bullets.
- Use Mermaid, code/usage snippets, before/after media, or benchmark tables only when they explain the change better than prose.
- Preserve issue-closing references and protected media.
- Do not make validation/test history, exact-head SHAs, TDD history, commit counts, or release-process notes default PR-body sections. This evidence remains in workflow gates, merge-ready records, and full-review verdicts.
- Keep initial routed PR creation draft-only; this design does not change lifecycle authority.

### Bot finding triage

Add one small canonical review-finding triage reference and compose it into bot-fix/full-review paths.

Every bot finding gets two independent classifications:

- **Truth:** `confirmed | false-positive | stale | unproven`
- **Action:** `must-fix | worth-fixing | decline | human-decision`

A finding is not fixed merely because a bot is technically plausible. `must-fix` requires evidence of a Bug, Security issue, Spec violation, documented repository-standard breach, compatibility/lifecycle/persistence risk, or another concrete material correctness/maintenance cost. `worth-fixing` is reserved for bounded improvements with a concrete reader/testability/maintenance benefit. Taste-only alternatives, speculative refactors, unsupported hypothetical failure modes, or style already accepted by repository tooling should be declined rather than creating scope creep.

Claims about library/runtime/API behavior must be checked against the actual pinned dependency/source or an executable probe when material.

### Code quality

Do not add a second code-review engine. Keep the existing Spec and Standards axes and their shared fixed comparison. Continue applying `references/design-quality.md` and `references/code-smells.md` as advisory lenses when relevant.

Full-review and merge-ready evidence should expose `Code quality` separately from the Spec and Standards conclusions so advisory design findings are visible without being confused with hard standards violations.

### Blast radius

Do not add a duplicate blast-radius subsystem. Reuse:

- `references/semantic-propagation-review.md` to map changed concepts beyond the diff; and
- `references/safety-invariant.md` to name and prove the one or two material facts a positive verdict depends on.

Review output should surface a compact `Blast radius` result containing local/non-local scope, affected concepts, safety invariant/proof level when applicable, confirmed risks, cleared risks, and remaining unproven assumptions. Local changes with no shared/public/persisted/non-local effect may report `n/a` with a concrete reason.

A material invariant that remains below executable proof must remain explicitly `unproven`; prose must not round it up to safe.

## Scope

Expected files:

- `references/pr-description.md`
- `references/review-finding-triage.md` (new)
- `references/policy/reviews.md`
- `references/fix-pr-bots.md`
- `references/full-review-pr.md`
- `references/spec-standards-review.md`
- `references/comment-depth.md`
- focused contract tests/evals
- `CHANGELOG.md` existing `1.4.7` section only

`package.json` remains `1.4.7`. No tag, GitHub Release, npm publication, merge, or ready-for-review transition is part of this work.
