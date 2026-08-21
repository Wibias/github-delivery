# Verify-PR-head direct spawn

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-052 only). Branch from current `origin/main`. Do not bundle installer `dist` ENOENT, 044–049, 060–062, 065–067, or 069.

## Problem

`scripts/verify-pr-head.mjs` calls `boundedSpawnSync(cmd, [], { shell: true })`. `boundedSpawnSync` always forces `shell: false`, so the whole command string is treated as an executable name. On Windows that is `EINVAL` / `status === null`. Git, `gh`, `mkdir -p`, and `test -f` never run as intended.

051 already fixed the same class in `validate-npm-package.mjs`. This file is the leftover.

## Approach

Spawn argv, never a shell string:

- Internal `git` / `gh` calls pass a file plus argument array.
- Create worktree parents with `mkdirSync(..., { recursive: true })`.
- Probe GUI tsconfigs with `existsSync`, not `test -f`.
- Default GUI typecheck runs `bun x tsc ...` with `cwd` set to `gui/`, not `cd gui && ...`.
- User `--*-cmd` strings tokenize into argv. A single `cd <dir> && rest` prefix may shift `cwd`; other shell metacharacters fail closed.

Do not restore `shell: true` on `boundedSpawnSync`.

## Tests

- Tokenizing `git status` yields `git` + `["status"]`.
- `cd gui && bun x tsc --noEmit -p tsconfig.app.json` yields `bun` with GUI cwd.
- Injected `run` spawn receives argv and `shell: false`.
- `verify-pr-head.mjs` does not pass `shell: true` or an empty argv to `boundedSpawnSync`.
