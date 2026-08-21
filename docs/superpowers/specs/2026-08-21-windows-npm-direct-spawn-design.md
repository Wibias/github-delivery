# Windows npm direct spawn

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-051 only). Branch from current `origin/main`. Do not bundle 052 (`verify-pr-head` shell), installer/`dist` ENOENT, 053, or docs-package work.

## Problem

`npm run package:check` runs `scripts/validate-npm-package.mjs`. On Windows that script spawns `npm.cmd` with `shell: true`. `boundedSpawnSync` always forces `shell: false`, so the spawn is `EINVAL` and `status` is `null`. The validator then fails `null !== 0`.

Ubuntu CI never hits this. Windows `npm run check` cannot finish.

## Non-goals

- Do not restore caller `shell: true` on `boundedSpawnSync`.
- Do not change `verify-pr-head.mjs` (GD-AUDIT-052).
- Do not fix the installer CLI test that fails on missing `dist/github-delivery/package.json`.

## Approach

Spawn npm the same way `scripts/publish-npm-idempotent.mjs` already does: `process.execPath` plus a JavaScript `npm-cli.js` path. Resolve that path from, in order:

1. `npm_execpath` when it exists and ends with `.js` / `.mjs` / `.cjs`
2. `dirname(execPath)/node_modules/npm/bin/npm-cli.js`
3. `dirname(execPath)/../lib/node_modules/npm/bin/npm-cli.js`

Skip `.cmd` / `.bat` `npm_execpath` values. Throw `npm_cli_unreadable` when no JS CLI exists.

## Tests

- Resolver prefers a JS `npm_execpath`
- Resolver skips `npm.cmd` and uses the node-adjacent JS CLI
- Resolver throws when nothing exists
- `validate-npm-package.mjs` does not mention `npm.cmd` or `shell: true`
- Existing packed-surface validator test passes on Windows
