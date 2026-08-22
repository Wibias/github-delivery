# Close linked issue PR binding

## Status

Approved 2026-08-22. Branch from current `origin/main`. GD-AUDIT-020 only.

## Problem

`close_linked_issue` is a generic `gh issue close` of an issue number. Authority scope does not bind a governing PR. The broker never checks that GitHub still lists the issue as a closing issue of that PR. Any issue in the repo can be closed under the "linked issue" action.

This does not change merge recapture (015/026) or SPDX/install findings.

## Approach

1. Require `pr` and `issue` on every `close_linked_issue` plan and authority scope.
2. Immediately before the close write, read `gh pr view --json closingIssues` for that PR. Fail closed if the payload is missing/malformed or the issue number is absent.
3. Keep the close command itself as `gh issue close`. Do not close from a guessed issue list.

Do not add a live GitHub mutation fixture.

## Tests

- A close request without a governing PR is rejected.
- A close request whose issue is not in the PR's `closingIssues` list is rejected before `gh issue close`.
- A matching closing-issue link is what gets closed.
- Authority scope changes when `pr` or `issue` changes.
