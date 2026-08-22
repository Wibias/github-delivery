# Orphan workflow cleanup stale-ref fence

## Status

Approved 2026-08-22. Branch from current `origin/main`. GD-AUDIT-019 only.

## Problem

`cleanup-orphaned-workflows` builds the full delete plan, then rereads the default-branch SHA once before the first DELETE. Later deletes in the same batch keep going if `main` moves. Run-head workflow presence uses Contents `ref=<head_branch>`, a moving alias. Restoring the workflow on that branch after a 404 still lets the planned DELETE run.

## Approach

1. Capture every run-head branch as an exact commit SHA before the presence check. Query Contents with that SHA, not the branch name.
2. Before each DELETE, re-read the default-branch SHA and every run-head SHA that justified that deletion. If any moved, fail closed and do not delete further runs.
3. Keep the existing preflight-all-reads-before-first-DELETE rule, completed-runs-only rule, and deletion cap.

Do not change workflow YAML permissions, schedule, or pin SHAs.

## Tests

- After the first DELETE in a multi-run plan, a moved default branch stops later deletes.
- After a run-head absence check, a moved run-head branch (workflow restored, `main` unchanged) stops deletion.
- Presence checks use the captured SHA, not the branch alias.
