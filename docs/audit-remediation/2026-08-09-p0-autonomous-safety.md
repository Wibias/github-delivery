# P0 Audit Remediation: Autonomous Safety Blockers

Baseline audit: `d5137472eafb660c18306d28484f6850aeab6ac4` on 2026-08-09.

This branch owns only the blockers that must be fixed before autonomous GitHub mutations are considered safe.

## Scope

### 1. Route all review-thread resolution through the mutation broker

Audit finding: `GD-AUDIT-001`.

Required outcome:

- Remove direct GitHub GraphQL mutation execution from `scripts/review-threads.mjs`.
- Make `resolve_thread` and `resolve_bot_thread` broker-owned actions.
- Bind authority to repository, PR, exact thread ID, action, mutation mode, and exact expected PR head.
- Require trusted scoped authority wherever the equivalent merge-relevant mutation class requires it.
- Preserve bot-vs-human restrictions, but do not treat those checks as authority proof.
- Ensure every network-visible thread-resolution write is auditable through the same mutation receipt path as other GitHub writes.
- Fail closed when head, thread identity, grant, or target state is stale or unknown.

Acceptance criteria:

- No production helper outside the approved mutation broker can invoke `resolveReviewThread` directly.
- A valid local caller assertion without the required trusted authority cannot resolve a protected thread.
- A stale expected head cannot resolve a thread.
- Bot resolution cannot resolve a human-authored thread.
- Existing read-only behaviour remains read-only.
- Broker receipts identify the exact resolved thread and authority provenance.
- Regression tests prove allowed thread-resolution writes pass through the broker, not only that denied writes fail.

### 2. Evaluate required checks on GitHub's authoritative commit

Audit finding: `GD-AUDIT-002`.

Required outcome:

- Capture both PR head SHA and GitHub test merge commit SHA when available.
- Implement GitHub's required-check selection rule centrally:
  - when the test merge commit has check/status evidence, that commit is authoritative;
  - otherwise the PR head is authoritative.
- Bind the ship-gate result to the exact SHA whose checks were evaluated.
- Fail closed when the authoritative check SHA cannot be established.
- Keep final head/base/ruleset freshness checks; this change must strengthen, not replace, the existing TOCTOU controls.

Acceptance criteria:

- Fixture: head green + test merge commit red => gate is blocked.
- Fixture: test merge commit has no check/status evidence + head green => head may be authoritative.
- Fixture: authoritative test merge commit changes after base movement => previous gate evidence is invalidated.
- Gate output reports the authoritative check SHA and why it was selected.
- No merge-ready verdict can be produced from green head checks when GitHub would require a failing test merge commit.

## Non-goals

- P1 same-name Check Run + Commit Status collision semantics.
- Merge queue lifecycle support.
- Dependency Review fallback changes.
- Stack ref identity changes.
- P2/P3 hardening and optimisation.

## Validation required before ready-for-review

- Run the repository's authoritative validation suite.
- Add focused regression tests for both findings.
- Run the supported Node 22 and Node 24 matrix where practical.
- Verify no new direct GitHub write path exists outside the broker and explicitly approved fixture harness.
