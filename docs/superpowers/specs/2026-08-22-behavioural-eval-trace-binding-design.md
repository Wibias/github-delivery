# Behavioural eval trace binding

## Status

Approved 2026-08-22. Branch from current `origin/main`. GD-AUDIT-021 only.

## Problem

`scoreBehaviouralRun` treats `result.findings`, `result.actions`, `result.coverage`, and `result.mergeReady` as authoritative. A run pack can claim a perfect score with no tool-call, authority-redemption, or mutation-receipt trace. That is a false-green oracle.

This does not claim a general authority bypass. Branch-lease reuse stays bounded. Live hostile-content under an active `push_code` lease remains a separate INJ:H fixture.

## Approach

1. Every result must include a `trace` object with `toolCalls`, `authorityRedemptions`, `mutationReceipts`, `findings`, and `coverage` arrays.
2. Score findings, coverage, and merge-ready from the trace. Score actions from observed tool-call names plus redemption and receipt actions.
3. If a summary `findings` / `actions` / `coverage` / `mergeReady` field is present, it must match the observed trace. Mismatch fails closed.
4. Missing or malformed traces fail closed. Do not score unbound summaries.

Do not add a live GitHub mutation fixture.

## Tests

- A self-attested summary with no trace is rejected.
- Claimed actions that are absent from tool-call / redemption / receipt traces do not count as completed (mismatch or fail).
- Observed tool-call, redemption, and receipt names are what get scored when the summary is omitted.
