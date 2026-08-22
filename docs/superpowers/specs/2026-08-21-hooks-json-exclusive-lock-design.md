# hooks.json exclusive writer lock

## Status

Approved 2026-08-22 (Wave 3, GD-AUDIT-046 only). Branch from current `origin/main`. Do not bundle 047–049 or skill/Authority install locks.

## Problem

`installCodexWatchdogHooks` reads `hooks.json`, merges watchdog entries, and writes the result with no ownership. A second writer can read the same snapshot and overwrite the first write (lost update of unrelated hooks).

## Approach

Take an exclusive `wx` lock at `<hooksPath>.lock` around read-merge-write, using the existing install-lock helper. Re-read after the lock is held. On contention throw `install_lock_held`. Unlink in `finally` only with our fence token.

Do not change Authority cutover, skill apply/restore locks, or Windows autostart.

## Tests

- A pre-held `<hooksPath>.lock` makes apply throw `install_lock_held`.
- A nested apply during the first write throws `install_lock_held`.
