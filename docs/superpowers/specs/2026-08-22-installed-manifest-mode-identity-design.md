# Installed manifest mode and file identity

## Status

Approved 2026-08-22 as leftover GD-AUDIT-041. Branch from current `origin/main`.

## Problem

`compareInstalledManifest` treats a tracked path as clean when `exists` is true and the SHA-256 of `readFile` matches. `readFile` follows symlinks. A symlink or directory with the same bytes as the release file is reported clean. The manifest already declares POSIX `mode` (`0644` / `0755`), but comparison never checks it.

This does not change 042 (archive extraction path identity).

## Approach

1. `lstat` each tracked path. Do not follow. ENOENT is `missing`. Anything other than a regular file is `not_regular`.
2. Require manifest `mode` to be `0644` or `0755`. On POSIX, compare `(stats.mode & 0o777)` and report `mode` on mismatch. On Windows, skip permission bits because NTFS does not preserve them; tests that care about mode set `enforcePosixMode: true`.
3. Hash only after the path is a regular file. One reason per path: type, then mode, then content.

## Tests

- A symlink or directory whose followed content matches the manifest hash is `not_regular`, not clean.
- A regular file with the right hash and the wrong POSIX mode is `mode` when mode enforcement is on.
- Existing missing/changed oracles still hold when `lstat` reports a regular file.
