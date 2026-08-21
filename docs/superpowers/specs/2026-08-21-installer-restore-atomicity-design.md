# Installer restore atomicity

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-043 only). Branch from current `origin/main`. Do not bundle 044–049, 052, installer `dist` ENOENT, 060–062, 065–067, or 069.

## Problem

`applyInstallation` moves the live target to backup, then `cpSync`s the new tree into that path. A crash during copy leaves a half-written install; the catch path never runs.

`restoreBackup` `rmSync`s the live target, then renames the backup into place. If that rename fails, the current tree is gone and only the older backup remains.

## Approach

- Stage the new tree in a sibling directory. Displace the live target only after that copy succeeds, then rename the staged tree into place.
- Restore by renaming the live target aside, renaming the backup into place, then deleting the aside copy. If the backup cannot land, put the aside copy back.
- Failed staging must not move the live target.

Do not change Authority cutover, `hooks.json` writers, CWD identity, or the missing-`dist` CLI plan.

## Tests

- Staging copy uses a path other than the live target, and the previous payload is still there while that copy runs.
- Injected staging failure does not displace the live target.
- Restore keeps the live target when renaming the backup into place fails.
