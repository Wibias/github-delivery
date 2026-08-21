# Router negated-merge prep (GD-AUDIT-065)

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-065 only). Branch from current `origin/main`. Do not bundle 066, 067, or 069.

## Problem

`isMergeDiscussion` runs before simplify / full-review / fix-CI / fix-review-comments / watch. After `hasExplicitMergeIntent` is already false, any leftover whole-word `merge`/`ship` (including `do not merge`) steals the request into `status.md` with no `push_code`. `without merging` still works because `\bmerge\b` does not match `merging`. Bare `do not merge PR #N` as status is correct.

## Approach

Do not treat a prompt as merge-discussion when a real prep predicate matches. Keep deliberative `Should I merge PR #N or simplify it first?` as status. Keep bare negated merge as status. Do not grant `merge_pr`.

## Tests

- `simplify PR #32, do not merge` → `simplify-pr.md` with `push_code`, no `merge_pr`
- `make PR #42 green but do not merge` → `fix-pr-bots.md` with `push_code`
- `watch PR #77 but do not merge` → `watch-pr.md`, read-only
- `Should I merge PR #32 or simplify it first?` → `status.md`, read-only
