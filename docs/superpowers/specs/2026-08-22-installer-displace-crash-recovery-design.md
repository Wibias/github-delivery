# Installer displace crash recovery

## Status

Approved 2026-08-22. Branch from current `origin/main`. Installer replace journal only.

## Problem

Staging reduced GD-AUDIT-043, but a hard crash after `target → backup` and before `staging → target` still leaves no live target. The catch path never runs.

This does not change Authority cutover, lock policy, or source identity.

## Approach

1. Write a durable install journal before displacing the live target.
2. Record the displaced phase after the target has moved to backup.
3. On the next apply, or via explicit recover, finish the swap if staging is intact, otherwise restore the backup.
4. Delete the journal only after a live target exists.

Do not add a live GitHub mutation fixture.

## Tests

- After a crash between displace and staging rename, recover leaves a live target.
- The next apply recovers that interrupted replace before planning a new copy.
