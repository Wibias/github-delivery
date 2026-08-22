# Install CLI missing dist fallback

## Status

Approved 2026-08-22. Branch from current `origin/main`. Do not bundle audit-state regeneration, Authority cutover, installer locks, or `--update` release fetch.

## Problem

Default `--source` is `<installedRoot>/dist/github-delivery`. A git checkout or worktree without `npm run build:dist` has no that tree. `node scripts/install-skill.mjs` then dies with `ENOENT` on `dist/github-delivery/package.json` instead of printing a dry-run plan.

CI hides this because it builds `dist` first. Local and worktree checkouts do not.

## Approach

In `parseInstallArgs`, after flags are parsed, if `--source` was not explicit:

1. Prefer `<installedRoot>/dist/github-delivery` when that directory has a `package.json`.
2. Otherwise use `installedRoot` when that root has a `package.json`.
3. Otherwise keep the packaged dist path so a missing tree still fails closed later.

Explicit `--source` never falls back. `--update` still fetches a verified release and does not install from this local default.

Do not change target defaults, Authority reconcile, `hooks.json`, or lock files.

## Tests

- Dry-run CLI from a file path succeeds when `dist/github-delivery` is absent and the bundle root has `package.json`.
- Missing dist falls back to `installedRoot`, not `process.cwd()`.
- Present dist keeps the packaged path.
- Explicit `--source` is unchanged even when that path is missing.
