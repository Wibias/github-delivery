# Installer exclusive target lock

## Status

Approved 2026-08-22 (Wave 3, GD-AUDIT-045 only). Branch from current `origin/main`. Do not bundle 046–049, hooks.json writers, or Authority cutover rollback.

## Problem

`applyInstallation`, `restoreBackup`, and `reconcileStableAuthorityHost` mutate shared trees with no ownership. A second installer can stage/rename the same skill target mid-copy, and a second Authority reconcile can fetch and install while the first still owns the root. The later writer can land on a stale target identity.

## Approach

Take an exclusive `wx` lock beside the mutation root before planning-and-applying or reconciling:

- Skill target: `dirname(target)/.github-delivery-install.lock`
- Authority root: `<root>/.github-delivery-authority-install.lock`

Write a fence token (`pid` + random bytes). On `EEXIST` (or Windows `EPERM` for an existing lock), throw `install_lock_held`. Unlink in `finally` only when the file still contains our token. Re-plan the skill install after the lock is held.

Do not wait. Do not steal stale locks in this change. Do not lock `hooks.json`.

## Tests

- Nested `applyInstallation` during the first staging copy throws `install_lock_held`; the first apply still finishes.
- Nested apply during `restoreBackup` throws `install_lock_held`.
- A pre-held Authority lock file makes `reconcileStableAuthorityHost` throw `install_lock_held` without installing.
