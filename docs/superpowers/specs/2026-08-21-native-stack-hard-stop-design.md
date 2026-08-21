# Native-stack merge hard-stop

## Status

Approved 2026-08-21 (approach 1). Fixes GD-AUDIT-071 only. Branch from current `origin/main`. Do not bundle 050, 072, 051, or docs-package work. Do not implement `merge-async` / `gh stack merge`.

## Problem

GitHub native stacks are live on this repository. Ship-gate, inspect-stack, and `merge_pr` still treat inferred open-PR base links as the only stack oracle and still plan `gh pr merge`.

That API cannot merge a native stack. GitHub cascade-lands every lower layer via `PUT .../merge-async` or `gh stack merge`. A trunk-targeting native-stack member stays independently eligible. A missing `stack` field is treated like “not a stack.”

This is unread identity plus the wrong merge API. It is not the 072 stack-base protection oracle.

## Goals

1. Snapshot must query native stack identity. GraphQL `null` means unstacked. An unqueried / missing field is unknown, not unstacked.
2. When `stack` is present, ship-gate is not ready, merge eligibility is not independent, and merge-boundary refuses `gh pr merge`.
3. Native membership wins when it disagrees with inferred bases (inspect-stack and eligibility).
4. Unstacked PRs (`stack: null`) are unchanged.

## Non-goals

- No `merge-async`, UUID poll, 409 handling, or `gh stack merge`.
- No stack-base ruleset fetch (072).
- No auto-merge emission for stacks (already not emitted).

## Identity

Read `snapshot.evidence.pullRequest.stack`.

| Value | Meaning |
|---|---|
| key absent / `undefined` | `policy:native_stack_unreadable` |
| `null` | not a native stack |
| non-object | unreadable |
| object without integer `size >= 1` | unreadable |
| object with `size >= 1` | present: `policy:native_stack_unsupported` |

Live capture queries GraphQL `stack { number size }` and `stackEntry { position }` on the policy query, then copies the result onto `pullRequest.stack` (`null` or object). REST list/get `stack` is preserved on inspect-stack rows. REST omission on an unstacked list row stays unstacked; GraphQL is the snapshot oracle for missing versus `null`.

## Eligibility

`evaluateMergeStackEligibility`: if the target’s `stack` identity is present, return `eligible: false`, `reason: "native_stack_unsupported"`. Inferred `stack_parent_unlanded` still applies to unstacked inferred children. Native membership wins: a trunk-targeting member with `stack` set is not independently eligible.

## Merge boundary

Throw `merge_boundary_native_stack_unreadable` when identity was not captured. Throw `merge_boundary_native_stack_unsupported` when a native stack is present. Unstacked (`null`) keeps today’s strict-checks / merge-queue coherence rules.

`commandFor` stays `gh pr merge` for unstacked PRs. Stacked PRs never reach that argv.

## Inspect-stack

Keep `stack` on normalized PR rows. PRs that share a native stack id/number are one stack ordered by `position`, even when every member targets trunk. A member with an open lower-position sibling is not a root.

## Docs

- `references/stacked-prs.md`: when GitHub returns native `stack`, that membership is authoritative; github-delivery will not merge it with `gh pr merge`.
- `GD-STACK-001`: discover native identity as well as inferred bases; native wins on disagreement.
- `GD-STACK-002`: do not merge a native-stack member as an independent trunk PR.

## Tests

- Missing `stack` key → ship-gate unknown `policy:native_stack_unreadable`
- `stack: null` + otherwise ready → still ready
- `stack: { size, ... }` → unknown `policy:native_stack_unsupported`, not ready
- Trunk-targeting member with `stack.size >= 2` → not eligible
- Inferred child without `stack` → still `stack_parent_unlanded`
- Merge-boundary throws unsupported when stack present; throws unreadable when stack missing
- Two trunk-targeting PRs with the same stack id are one inspect-stack ordered by position
