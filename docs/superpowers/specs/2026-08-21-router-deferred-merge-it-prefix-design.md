# Router deferred merge-it prefix (GD-AUDIT-066)

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-066 only). Branch from current `origin/main`. Do not bundle 067 or 069.

## Problem

`routeShippingGithubPrompt` grants `merge-pr.md` with `merge_pr` when the prompt starts with `merge it` or `ship it`, without applying `hasExplicitMergeIntent`. Deferred and negated follow-ons still match the prefix: `merge it only after I confirm`, `ship it, but do not merge PR #42`. Bare `merge it` / `ship it` remain intended.

## Approach

Require `hasExplicitMergeIntent` for the prefix disjunct. Keep bare `merge it` / `ship it` as merge-pr because `ASSISTANT_MERGE_REQUEST` already accepts them.

## Tests

- `merge it only after I confirm`, `ship it only after I confirm`, `merge it after asking me`, and `ship it, but do not merge PR #42` must not grant `merge_pr`
- Bare `merge it` and `ship it` still load merge-pr with `merge_pr`
