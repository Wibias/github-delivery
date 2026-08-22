# Merge authority base binding

## Status

Approved 2026-08-22. Branch from current `origin/main`. GD-AUDIT-026 only.

## Problem

`merge_pr` authority is scoped to PR, expected head, and merge method. Base identity is not in the grant. A retarget that keeps the same head can reuse that grant. The merge driver recaptures `baseRefName` / `baseOid` before the write, but the grant itself remains head-only.

This does not reopen 015 (server-enforced merge boundary) or change SPDX/install findings.

## Approach

1. Require `expectedBase` and `expectedBaseOid` on every `merge_pr` plan and authority scope.
2. Build the driver merge request from the approved merge boundary, not from a head-only identity.
3. Immediately before the merge write, reread live `baseRefName` and `baseRefOid`. Fail closed on mismatch. Do not spawn `gh pr merge` if the base moved.

Do not add a live GitHub mutation fixture.

## Tests

- Merge authority scope includes base name and base OID. Changing either changes the scope hash. Missing either is rejected.
- A merge request whose live base OID does not match the grant is rejected before `gh pr merge`.
- The merge driver request carries the approved boundary base, not only the head.
