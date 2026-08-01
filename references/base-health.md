# Base-health isolation

Use the authoritative `ship-gate.mjs` output whenever a PR head has failing required checks. The `baseHealth` component compares the latest check-run and commit-status identities on the PR head with the current base tip.

## Classifications

- `prOnlyFailures`: failing on the PR head while the same identity passes or is absent on base. Fix these in the PR.
- `sharedFailures`: the same identity fails on both head and base. The failure may still block merging, but it does not automatically expand the PR implementation scope. Create or link a focused follow-up and report the repository-level blocker.
- `unknownFailures`: comparison evidence is incomplete or the base state is pending/unknown. Do not claim the failure is unrelated and do not claim readiness.
- `baseOnlyFailures`: failing on base but not on the PR head. Report as an advisory and track separately.

A green PR head does not require base comparison evidence. Base comparison becomes fail-closed only when the head has failures whose origin affects scope.

## Output contract

```json
{
  "decision": "blocked",
  "comparisonRequired": true,
  "scopeRecommendation": "separate_follow_up",
  "sharedFailures": [{ "context": "CI", "appId": 10 }],
  "prOnlyFailures": [],
  "unknownFailures": []
}
```

`scopeRecommendation` values:

- `fix_in_pr`
- `separate_follow_up`
- `investigate`
- `none`

The authoritative gate can remain blocked by a shared failure. Isolation controls **where the repair belongs**, not whether a red required check magically becomes green.
