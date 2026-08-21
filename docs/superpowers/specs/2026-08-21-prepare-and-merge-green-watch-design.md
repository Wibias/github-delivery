# Prepare-and-merge for green and watch

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-063 only). Branch from current `origin/main`. Do not bundle 065 merge-discussion steal, 066 `merge it` prefix without `hasExplicitMergeIntent`, 067 watch auto-fix authority, 060–062, or 052.

## Problem

`isPrepareAndMergeRequest` composes full-review, review, fix-comments, and simplify with explicit merge. It omits `EXPLICIT_GREEN_REQUEST` and watch. Those prompts hit the later `merge-pr.md` shortcut instead:

- `fix CI on PR #42 and ship it`
- `make PR #42 green and merge it`
- `watch PR #77 and merge it`

SKILL.md requires compound review/fix/simplify **plus merge** to load `prepare-and-merge-pr.md` and finish preparation first. Green/watch are the documented fix-CI / watch rows. Ship-gate still blocks a red check, so this is routing, not a false merge.

## Approach

1. Extract the existing watch+PR matcher as `WATCH_PR_REQUEST`.
2. `isPrepareAndMergeRequest` also returns true for `EXPLICIT_GREEN_REQUEST` and `WATCH_PR_REQUEST` (still requires `hasExplicitMergeIntent` and a PR reference).
3. `prepareAndMergeActions` adds `push_code` for green/CI-fix the same way it does for fix-comments and simplify. Watch+merge does not add `push_code`.

Keep `watch PR #77 until it merges or needs me` read-only. Keep `merge PR #32` on `merge-pr.md`. Do not move the `/^merge it\b/` shortcut behind `hasExplicitMergeIntent` (066). Do not reorder overtake/supersede/issue matchers (063 extras, later PRs).

## Tests

- `fix CI on PR #42 and ship it` → `prepare-and-merge-pr.md`, includes `push_code` and `merge_pr`
- `make PR #42 green and merge it` → same
- `watch PR #77 and merge it` → `prepare-and-merge-pr.md`, includes `merge_pr`, does not include `push_code`
- Existing review/simplify/fix-comments + merge cases stay prepare-and-merge
- Watch without assistant merge intent stays read-only
