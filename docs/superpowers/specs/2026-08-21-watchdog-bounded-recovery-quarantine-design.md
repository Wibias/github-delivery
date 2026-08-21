# Watchdog bounded-recovery quarantine

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-054 only). Branch from current `origin/main`. Do not bundle 055 (empty-model `sameModel` wildcard), 060–062, 065–067, or 069.

## Problem

A no-progress narration stall that exhausts bounded recovery hard-stops the current turn with `no_progress_stall_after_bounded_recovery`. Session quarantine only persists `tool_protocol_emission_stall`, `repeated_no_progress_stall_after_recovery`, and `severe_no_progress_recovery_completed`. Recovery counters are turn-scoped, so the next turn with the same model starts a fresh 1/N recovery cycle. The hard-stop is infinitely restartable.

## Approach

Add `no_progress_stall_after_bounded_recovery` to the Stop quarantine set. The following `UserPromptSubmit` with the same model blocks until the model changes or the task is new. Do not quarantine `SubagentStop` (parent task stays usable). Do not change empty-model `sameModel` matching.

## Tests

- Exhaust bounded recovery on `Stop`, then `UserPromptSubmit` on a new turn with the same model is `decision: block`.
- That hard-stop reports `quarantinePersisted: true`.
