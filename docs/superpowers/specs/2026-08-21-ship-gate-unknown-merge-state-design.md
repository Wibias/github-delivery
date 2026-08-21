# Ship-gate fail-closed unknown merge state

## Status

Approved 2026-08-21. Fixes GD-AUDIT-058 only. Branch from `origin/main` (`0868e9e`). Do not bundle 050, 071, 072, 051, or docs-package work.

## Problem

`combineShipGateResults` treats GitHub `mergeStateStatus === "BLOCKED"` as unknown. Every other merge enum, including `UNKNOWN` and a missing value, can still produce `ready` when the other components are green.

`executeMergeTransaction` already refuses to spawn `gh pr merge` unless the gate is ready. The defect is false-ready, not a success claim after a failed merge.

`selectAuthoritativeCheckEvidence` prefers a present test-merge SHA (`merge_commit_sha`) whenever that SHA has check evidence. GitHub can leave that SHA around while GraphQL mergeability is still `UNKNOWN`, so required checks can look green on a stale test merge.

## Goals

1. Ship-gate must not be `ready` when GitHub has not computed mergeability, or when the merge enum is unrecognised.
2. Snapshot capture must not treat a test-merge SHA as the check oracle while mergeability is uncomputed.
3. `CLEAN` stays ready. Existing `BLOCKED` unknown behaviour stays. Dirty/behind/conflict stay blocked by the wake evaluator.

## Non-goals

- No merge-driver or broker hard-stop beyond the existing `ready` requirement.
- No change to merge-boundary fingerprints.
- No stacked-PR merge (`071`), no stack-base rules (`072`), no Admin bypass completeness (`050`).
- No live `gh pr merge` probe of GitHub `UNKNOWN` behaviour.

## GitHub merge enums

Use GraphQL `MergeStateStatus` as the combiner oracle:

| Status | Combiner |
|---|---|
| `CLEAN` | merge-state does not block ready |
| `UNSTABLE` | merge-state does not block ready |
| `HAS_HOOKS` | merge-state does not block ready |
| `BLOCKED` | unknown: `policy:github_merge_state_blocked` |
| `UNKNOWN`, empty, missing | unknown: `policy:github_merge_state_unknown` |
| `DRAFT` | unknown: `policy:github_merge_state_unknown` (covers `isDraft=false` mismatch; true drafts already fail review policy) |
| any other string | unknown: `policy:github_merge_state_unknown` |
| `DIRTY`, `BEHIND`, `CONFLICTING` | leave to wake (`base-state` / `merge_state`); combiner does not add a merge-state unknown |

REST `mergeable === "CONFLICTING"` stays a wake blocker. This change does not add a second combiner oracle for REST `mergeable`.

## 1. Combiner

File: `scripts/lib/ship-gate-policy.mjs`.

Replace the `BLOCKED`-only special case with an explicit table matching the matrix above. Keep `BLOCKED`'s existing unknown code so current tests stay meaningful.

Decision precedence is unchanged: any blocker → `blocked`; else any unknown → `unknown`; else `ready`.

## 2. Test-merge SHA

File: `scripts/lib/required-checks-policy.mjs`, called from `scripts/ship-gate-snapshot.mjs`.

`selectAuthoritativeCheckEvidence` gains `mergeStateStatus`. Snapshot capture must pass the GraphQL `mergeStateStatus` from `pr view`.

When the normalised status is `UNKNOWN`, empty, or not in the official GraphQL set `{BEHIND, BLOCKED, CLEAN, DIRTY, DRAFT, HAS_HOOKS, UNKNOWN, UNSTABLE}`, ignore `testMergeOid` and use HEAD check evidence. Reason: `test_merge_ignored_mergeability_unknown`.

When the argument is omitted, keep today's test-merge preference so existing unit tests stay valid. Live snapshot capture must pass the field.

Do not ignore a test-merge SHA for `CLEAN`, `UNSTABLE`, `HAS_HOOKS`, `BLOCKED`, `DIRTY`, `BEHIND`, or `DRAFT`. Those are computed states; `UNKNOWN` is the stale-SHA case.

A failing HEAD required check still blocks even when merge state is `UNKNOWN`. After this change, a green stale test-merge SHA cannot hide that HEAD failure while mergeability is uncomputed. Overall ready remains false either way because the combiner is unknown.

## 3. Tests

`tests/unit/audit-remediation.test.mjs` (keep the existing `BLOCKED` case):

- `UNKNOWN` → not ready, includes `policy:github_merge_state_unknown`
- missing / empty `mergeStateStatus` → not ready, same unknown code
- unrecognised enum (for example `FUTURE_STATE`) → not ready, same unknown code
- `DRAFT` with `isDraft: false` → not ready
- `CLEAN` with otherwise-ready components → still ready
- failing required checks with `UNKNOWN` merge state → `blocked`, not ready

`tests/unit/required-checks-policy.test.mjs`:

- `UNKNOWN` plus a present test-merge SHA that has check evidence → selected SHA is HEAD, reason `test_merge_ignored_mergeability_unknown`
- `CLEAN` plus a present test-merge SHA that has check evidence → still prefers the test merge (`test_merge_has_status`)
- omitted `mergeStateStatus` → still prefers the test merge (current tests)

No merge-driver test is required: the driver already refuses unless `ready` is true.

## Error handling

Unknown merge state is not a crash. The gate returns `decision: "unknown"`, `ready: false`, exit code `2`. Merge does not run.

## Out of scope if discovered during implementation

If a test shows `CLEAN` with REST `mergeable` `UNKNOWN`, record it and stop. Do not widen this PR to a second oracle without a new approval.
