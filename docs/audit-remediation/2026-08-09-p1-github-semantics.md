# P1 GitHub semantics and dependency safety

Audit baseline: `d5137472eafb660c18306d28484f6850aeab6ac4`

Stack base: P0 head `e77098c95c033b503c346e5d3b17925f4fde43c9`

## Scope

This PR owns the next three audit findings in order:

1. Required-check source semantics: a same-name commit status must still participate when an app-bound Check Run exists.
2. Merge-queue outcome semantics: a successful `gh pr merge` command must not be reported as an immediate merge when GitHub queued the PR or enabled auto-merge.
3. Dependency-review fallback coverage: degraded fallback must not claim dependency-free success when non-Node manifests/lockfiles such as NuGet are present.

## Acceptance

- [ ] App-bound required check + same-name failing commit status is blocked.
- [ ] App-bound required check + same-name pending/unknown commit status does not report ready.
- [ ] Merge mutation returns a typed outcome: `merged`, `queued`, `auto_merge_enabled`, `already_merged`, or failure.
- [ ] Post-merge social/cleanup operations run only for actual `merged`/`already_merged` outcomes.
- [ ] A successful merge CLI exit with `mergedAt == null` is not treated as merged.
- [ ] Dependency-review fallback detects supported non-Node dependency manifests/lockfiles.
- [ ] This repository's `.csproj` / `packages.lock.json` make action failure fail closed rather than `dependency_free_degraded_pass`.
- [ ] Focused regression tests are added before each implementation change.
- [ ] Full repository validation passes on Node 22/24 across Linux, macOS and Windows.
- [ ] Dependency Review and CodeQL pass.

## Ordering

Implement and verify the items exactly in the order above so a later fix cannot mask an earlier regression.
