# Ship-gate native-stack protection oracle

## Status

Approved 2026-08-21 (approach 2). Fixes GD-AUDIT-072 only. Branch from `origin/main`. Do not bundle 050, 058, 071, 051, or docs-package work. Do not implement `merge-async` / `gh stack merge`.

## Problem

Ship-gate fetches `rules/branches/{PR base}`, classic protection, CODEOWNERS, and workflow coverage from the pull request’s current `baseRefName`. GitHub native stack merge evaluates Protect **stack base** (usually `main`) and the remaining contiguous group.

A stacked PR whose base is a feature branch gets `[]` rules. Empty required-check descriptors enter observed mode and can be **ready**. Brokered `gh pr merge` still fails at merge-boundary when those captured rules lack strict checks. GitHub UI / `gh stack` / `merge-async` do not.

## Goals

1. When GraphQL/REST `stack` is present, protection discovery uses `stack.baseRefName` / `stack.base.ref`, not the PR’s parent feature ref.
2. Empty or unreadable stack-base rules never become observed-mode ready.
3. More than one remaining stack layer is unknown (`policy:native_stack_remaining_layers_unevaluated`). This PR does not snapshot lower layers.
4. Merge-boundary still refuses direct `gh pr merge` while native stack identity is present, so filling stack-base strict checks into `activeRules` cannot enable the unread stack merge API.
5. Unstacked PRs keep today’s PR-base oracle. Inferred github-delivery stacks (parent is another open PR head, `stack` is null) are unchanged.

## Non-goals

- No `merge-async`, `gh stack merge`, or brokered native-stack merge (071).
- No per-layer snapshots of the remaining group.
- No change to 058 merge-enum handling.
- Immediate-parent `baseOid` / wake dirty-behind stay on the PR base (review/diff parent).

## Identity

Normalize stack from either GraphQL `{ size, baseRefName }` or REST `{ size, base: { ref } }`.

| Input | Result |
|---|---|
| `stack` null/absent | not a native stack |
| present, missing `size` or base ref | `policy:native_stack_unreadable` |
| `size > 1` | `policy:native_stack_remaining_layers_unevaluated` |
| native stack and required-checks `mode === "observed"` | `policy:native_stack_observed_checks` |

## Capture

`ship-gate-snapshot.mjs` reads stack before `rules/branches`. Protection ref = stack base when complete, else PR `baseRefName`. Dual-read of final rules uses the same protection ref. Attach the raw `stack` object on `evidence.pullRequest`.

## Merge-boundary

If native stack is present, throw `merge_boundary_native_stack_unsupported` before treating stack-base strict checks as licence to call `gh pr merge`.

## Docs

Amend `GD-STACK-005`: inferred parent remains review/diff parent; native-stack merge/readiness uses the stack base.

## Tests

- #287-shaped: feature `baseRefName`, `stack.size=5`, empty feature rules → ship-gate not ready.
- Same shape with Protect main descriptors still not ready (remaining layers).
- Unstacked empty descriptors can still be observed-ready.
- Unreadable stack → unknown.
- Native stack present → merge-boundary throws.
- Snapshot source fetches `rules/branches` with the protection ref.
