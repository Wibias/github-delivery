# Install source package identity

## Status

Approved 2026-08-22 (Wave 3, GD-AUDIT-044 only). Branch from current `origin/main`. Do not bundle 045–049, 050, or the missing-`dist` CLI plan.

## Problem

`parseInstallArgs` defaults `--source` to `process.cwd()/dist/github-delivery`. Invoking the installer from another working directory plans or copies a different tree than the package that contains the CLI.

## Approach

Default `--source` to `<installedRoot>/dist/github-delivery`, where `installedRoot` is the running bundle root (`import.meta.dirname/..`). Explicit `--source` still wins. `--target` stays homedir-based unless `--update` or `--target` is set.

Do not change Authority cutover, `hooks.json` writers, installer locks, or restore atomicity.

## Tests

- After `chdir` to an unrelated directory, the default source is the package `dist` tree, not `$CWD/dist`.
- Explicit `--source` still overrides that default.
