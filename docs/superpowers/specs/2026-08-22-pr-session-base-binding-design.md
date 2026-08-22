# PR session approved-base binding

## Status

Approved 2026-08-22. Branch from current `origin/main`. PR-session identity only.

## Problem

PR sessions key consent by repository, PR number, and head branch. They do not bind the approved merge base. Retargeting the same PR reuses the session and skips Hello, reopening GD-AUDIT-026 on the session path.

This does not change Node/C# merge grant fields, attributed-text routing, eval provenance, or installer recovery.

## Approach

1. Resolve a session key from repo + branch + PR, plus `expectedBase` / `expectedBaseOid` when the batch contains `merge_pr`.
2. Persist those base fields on the session. A merge batch matches only a session with the same base. A session created without a base cannot authorize `merge_pr`.
3. Push-only batches may still use a matching repo/branch/PR session.
4. A merge operation missing base identity is not session-eligible.

Do not add a live GitHub mutation fixture.

## Tests

- Host source contracts persist and match `expected_base` / `expected_base_oid`.
- SelfTest: retargeted base does not reuse the session; a base-less session does not cover merge.
