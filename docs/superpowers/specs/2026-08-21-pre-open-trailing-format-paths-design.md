# Pre-open trailing format-character paths

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-062 only). Branch from current `origin/main`. Do not bundle 065–067, 069, or fail-closed unclassified `wasm`/`exe`.

## Problem

`CODE_RE` and `DOC_RE` are `$`-anchored on raw git paths. A code file plus a trailing format character (U+200B, U+202E, CR, space, NBSP) is not `isLogic`. Security depth becomes `skip`. A low-keyword patch (`const x = 1`) also skips bug review and makes pre-open `ready`. Mid-name ZWSP and a BOM prefix do not evade. 061’s `.mdc` list does not close this.

## Approach

Strip trailing Unicode format, control, and space characters before `CODE_RE` / `DOC_RE` / operational and UI extension matchers. Keep the original path in `logicFiles`. Do not treat ordinary unclassified JSON as logic. Do not change skill-router 065–067.

## Tests

- `src/worker.ts` + U+200B with `const x = 1` is logic, security/bug not skip, pre-open not ready.
- Trailing space after `.mjs`, trailing CR, U+202E, and NBSP reproduce the same.
- Mid-name U+200B and a BOM prefix still match `.ts` and stay logic. `src/pwn.ts` + U+200B + `.bak` stays non-logic.
