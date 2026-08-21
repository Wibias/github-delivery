# Watchdog stale-lock fencing

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-057 only). Branch from current `origin/main`. Do not bundle 052, installer `dist` ENOENT, hook output-shape extras, or docs-package work.

## Problem

`acquireLock` steals by `mtime` then `rmSync`. The holder always `rmSync`s the lock path in `finally`, with no owner token.

If the holder is still inside the reducer when a waiter treats the lock as stale:

1. The stealer deletes the lock and creates a new one.
2. The holder finishes and unlinks the **stealer’s** lock.
3. A third process can acquire while the stealer still believes it holds exclusion, and the holder can still `atomicWrite` after the steal (lost update).

## Approach

Put a unique fence token in the lock file at exclusive create (`pid` + random bytes).

- Steal a stale lock only if the token is unchanged between the stale check and `rmSync`.
- Before `atomicWrite`, re-read the lock token. If it is missing or not ours, throw `lost watchdog state lock` and do not write.
- In `finally`, unlink only when the lock file still contains our token.

Keep `wx` exclusive create, Windows `EPERM` retry, `lockWaitMs` / `staleLockMs`, and the existing fresh-lock timeout test. Do not switch to `flock`. Do not change hook exit codes (056).

## Tests

Two child processes sharing one state scope:

- Holder acquires and waits inside the reducer.
- Test ages the lock past `staleLockMs`.
- Stealer acquires and waits inside the reducer.
- Holder is released first: lock file still exists, holder exits non-zero with `lost watchdog state lock`, persisted state is not the holder’s write.
- Stealer is then released: lock is gone, persisted state is the stealer’s write.

Existing `fresh locks are respected and stale locks recover` stays valid for an unattended stale file.
