# Skill rollback when Authority reconciliation fails

## Status

Approved 2026-08-22 (Wave 3, GD-AUDIT-047 only). Branch from current `origin/main`. Do not bundle 048–049, installer locks, or hooks.json writers.

## Problem

`--update --apply` and guided install copy the skill tree, verify it, then reconcile Authority. If that Authority step throws, the skill stays on the new version. The catch path only attaches `backupPath`; it does not restore.

## Approach

After the skill payload is installed and verified, remember that skill-side state committed. If Authority reconciliation then fails and a backup exists, restore that backup onto the target before rethrowing. Set `error.rolledBack = true` when restore succeeds. Leave post-install verification and user-config-drift failures as backup-path-only (no automatic restore).

Do not change process kill/restart in `install-release.ps1`. Do not change Windows autostart.

## Tests

- `runInstallCommand` Authority throw restores the backup marker onto the target and sets `rolledBack`.
- Guided install Authority throw calls `restoreBackup` with the install backup and target.
