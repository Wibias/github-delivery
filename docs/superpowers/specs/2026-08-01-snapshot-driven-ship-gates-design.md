# Snapshot-Driven Ship Gates Design

## Goal

Complete the evidence-snapshot architecture in three stacked pull requests:

1. Make each gate support a zero-network `--snapshot` mode.
2. Add one authoritative `ship-gate.mjs` decision command.
3. Replace “any later commit clears feedback” with explicit feedback-to-commit resolution records.

## Constraints

- Node.js 20 or newer.
- No new runtime dependencies.
- Existing live-fetch CLI behavior remains available during migration.
- Snapshot mode performs no GitHub CLI or network calls.
- Incomplete, stale, mismatched, or internally inconsistent snapshots produce `unknown` and exit code `2`, never green.
- Individual gate exit codes remain `0` ready/clear, `1` blocked, `2` unknown/error.
- CI continues to run on Node.js 20 and 22 across Ubuntu, Windows, and macOS.

## PR 5: Snapshot consumers

Add a shared snapshot-input module that reads JSON, validates schema and kind, verifies repository and PR identity, checks envelope/head consistency, enforces a bounded capture age, and rejects incomplete snapshots. An optional expected head SHA strengthens callers that already know the current head without requiring a network request.

Add pure snapshot evaluators for required checks, review policy, review threads, advisory CODEOWNERS, and wake/feedback state. Every evaluator consumes the same evidence layout. Each existing gate accepts `OWNER/REPO PR --snapshot FILE`, validates the snapshot before evaluation, and avoids invoking `gh` in that path. Live mode remains intact.

Extend snapshot capture with the evidence the consumers currently fetch independently: GraphQL branch-protection diagnostics, latest opinionated reviews, merge-queue fields, workflow-trigger coverage, viewer login, and CODEOWNERS parse errors.

## PR 6: Authoritative ship gate

Add `ship-gate.mjs`. In live mode it captures exactly one snapshot by invoking the snapshot command once. In snapshot mode it performs no network calls. It evaluates required checks, review policy, unresolved threads, and feedback state against that same snapshot. CODEOWNERS stays advisory.

Decision precedence:

1. Any known blocker produces `blocked`.
2. Otherwise, any incomplete or unknown component produces `unknown`.
3. Otherwise the decision is `ready`.

The output includes the snapshot ID, head SHA, namespaced blockers and unknowns, component summaries, and advisories. Exit codes are `0`, `1`, and `2` for ready, blocked, and unknown/error.

## PR 7: Feedback-specific resolution

Trusted feedback is identified by a stable key such as `review_comment:67890`. A feedback item is cleared only by a structured resolution record:

```text
[GD] Addressed feedback
feedback: review_comment:67890
commit: abc1234
```

A record is valid only when the feedback exists, the commit reference uniquely resolves to a non-merge commit on the PR, the commit occurred after the feedback, and the resolution record was posted after the commit. A record clears only the named feedback item. Unrelated later commits do nothing.

Malformed or invalid records are reported as diagnostics and never clear feedback. Review-thread resolution remains an independent blocker.

## Testing

- Unit tests exercise snapshot validation and every pure evaluator.
- CLI tests run snapshot mode with `gh` absent from `PATH` to prove zero-network behavior.
- Parity tests compare direct evaluator inputs with snapshot-backed evaluation.
- Composite-gate tests cover ready, blocked, unknown, and advisory-only states.
- Feedback tests prove exact-key resolution and reject unrelated, missing, early, merge, or ambiguous commits.
