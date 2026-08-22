# GraphQL -F at-file rejection (GD-AUDIT-069)

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-069 only). Branch from current `origin/main`. Do not mix installer 044–049.

## Problem

Typed GraphQL variables are interpolated into `-F key=${unsanitized}`. `gh` `-F/--field` expands `@path` as a local file read. `resolve_thread` `threadId`, merge-state repo `name`, and ship-gate `after` cursors can start with `@`. Body transport only rewrites `body=`.

## Approach

Reject any GraphQL `-F` value that starts with `@` before spawn. Keep `-f` for static query text. Keep `-F number=` only for already-validated integers.

## Tests

- `planMutationRequest` resolve_thread with `threadId` `@secret.txt` throws
- `readMergeState` with repo `acme/@secret.txt` throws before the runner
- Ship-gate snapshot interpolates `after` through the same guard
