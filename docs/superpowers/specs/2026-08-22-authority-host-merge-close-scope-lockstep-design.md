# Authority host merge/close scope lockstep

## Status

Approved 2026-08-22. Branch from current `origin/main`. Host/Node canonicalizer lockstep only.

## Problem

Node `merge_pr` authority binds `expectedBase` and `expectedBaseOid`. Node `close_linked_issue` binds the governing `pr`. The Windows host canonicalizer omits those fields, so Node recomputes a different scope hash and rejects the signed grant with `scope_mismatch`.

This is fail-closed, not an authority bypass. Trusted Windows `merge_pr` and `close_linked_issue` cannot complete.

This does not change PR-session identity, attributed-text routing, behavioural-eval provenance, or installer crash recovery.

## Approach

1. Host `merge_pr` scope must require and hash `expectedBase` and lowercase `expectedBaseOid`, matching Node.
2. Host `close_linked_issue` scope must require and hash governing `pr` plus `issue`, matching Node.
3. Update the host SelfTest merge fixture and pinned scope hash so they match `authorityScopeSha256` of the same JSON.

Do not add a live GitHub mutation fixture.

## Tests

- Windows `merge_pr` case source binds `expectedBase` and `expectedBaseOid`.
- Windows `close_linked_issue` case source binds `pr` and `issue`.
- SelfTest merge JSON hashes to the pinned `ExpectedMergeScope` under Node's canonicalizer.
