# Classify `gh api --input` as a write

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-070 only). Branch from current `origin/main`. Do not implement the 069 GraphQL `--input` JSON helper, 052, installer `dist` ENOENT, or 065–067 router siblings.

## Problem

`gh api --input` sends an HTTP body. Without `-X`/`--method`, `gh` POSTs. `isReadOnlyGitHubCommand` still treats field-less `gh api` as GET, so `gh api PATH --input -` is retryable on HTTP 429 and can duplicate a write.

Body transport already emits `--input -`. Current broker commands keep `--method PATCH`, so they are not retried today. A 069 GraphQL `--input` JSON change would drop `query=mutation` from argv and walk into this hole.

## Approach

In `isReadOnlyGitHubCommand`:

- `--input` / `--body-file` (including `--input=` forms) on `gh api` is a write unless the method is an explicit `GET`.
- `gh api graphql` with `--input`/`--body-file` and no argv `query=` is a write.
- Keep `gh api PATH` without fields, method, or stdin body as GET (retryable).
- Keep `-f`/`-F` without GET as POST. Keep `--method POST`/`PATCH` as writes.

Do not change body transport. Do not implement 069.

## Tests

- `gh api repos/.../issues/1 --input -` is not read-only
- `gh api graphql --input -` is not read-only
- `gh api PATH --input -` on HTTP 429 is not retried
- `gh api repos/acme/widgets` without `--input` remains read-only and retryable
- `gh api -X GET PATH --input -` remains read-only (explicit GET)
