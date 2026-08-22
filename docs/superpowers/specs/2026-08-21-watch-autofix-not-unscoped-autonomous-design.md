# Watch auto-fix is not unscoped autonomous (GD-AUDIT-067)

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-067 only). Branch from current `origin/main`. Do not bundle 068 or 069.

## Problem

`watch PR #N auto-fix` and `watch PR #N autonomously` select `watch-pr.md` in `autonomous` mode with empty `explicitActions`. Autonomous `buildProfile` allows `merge_pr` / `close_pr` / `delete_head_branch` without `explicitInstruction`. Maintainer already requires that instruction. Auto-fix is not merge authority.

## Approach

Require explicit instruction for autonomous merge/close/delete. Keep `auto-fix` from granting those actions. Bare `watch PR #N and merge it` stays prepare-and-merge.

## Tests

- `watch PR #32 auto-fix` and `watch PR #32 autonomously` do not grant merge/close/delete
- Autonomous `merge_pr` / `close_pr` / `delete_head_branch` without `explicitInstruction` are denied
- With `explicitInstruction`, those actions remain allowed for a true unattended-merge path
