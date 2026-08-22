# Mutation convergence (GD-AUDIT-004 remaining)

## Status

Approved 2026-08-22 as gen40 leftover GD-AUDIT-004 (numbering-conflict lineage, not first-wave PR 97). Branch from current `origin/main`.

## Problem

Three leftover holes from the same convergence root cause:

1. Mutation-document retry identity falls back to `action:repo:pr`, so two different payloads can skip as `already_applied`.
2. Stale autonomous-claim recovery re-reads the ref SHA and then DELETEs by name. A newer recovered claim can be deleted if the SHA changed after the age check.
3. `push_code` treats a timed-out or signal-killed `git push` as a clean failure without re-reading the remote tip, so an uncertain success cannot converge.

This does not reopen first-wave 004 (replay snapshot identity) or 003/009/011.

## Approach

1. Operation keys prefer `idempotencyKey`. Otherwise they hash the mutation payload. Never use `action:repo:pr`.
2. Before deleting a stale claim, re-read SHA and created-at. If either shows a newer claim, fail closed and do not DELETE.
3. If `git push` returns a null status or signal, `ls-remote` the branch. Match `newTip` → reconcile success; match the previous tip → original failure; anything else → `push_outcome_unknown`.

## Tests

- Two `push_code` payloads without idempotency keys do not share a skip identity.
- A SHA or freshness change before stale-claim DELETE does not delete.
- A timed-out push whose remote already shows `newTip` is reconciled, not retried as a lease failure.
