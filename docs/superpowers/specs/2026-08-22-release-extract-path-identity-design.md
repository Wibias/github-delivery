# Release extraction path identity

## Status

Approved 2026-08-22 as leftover GD-AUDIT-042. Branch from current `origin/main`.

## Problem

Release ZIP inspection treats path identity as an exact string. `package.json` and `Package.json`, or NFC vs NFD of the same letters, are different strings, so they pass the duplicate check. On Windows and macOS they can alias to one physical file. Extraction writes with `join` and does not re-read the tree, so a collision or a non-regular substitute after write is not caught.

This does not reopen 041 (installed-manifest mode) or 040 (SPDX).

## Approach

1. Portable identity: every archive and manifest path must already be Unicode NFC, unique after case-fold, and free of Windows-unsafe segment characters or reserved names.
2. Apply that contract when building a distribution, when validating a downloaded manifest, and when inspecting a ZIP.
3. After writing, walk the extracted tree with `lstat`/`readdir`. Each declared path must exist as that exact directory-entry name, as a regular file, with matching bytes and SHA-256.

## Tests

- A ZIP or manifest that contains case or Unicode aliases is rejected before a colliding write.
- A non-NFC path is rejected even when it is the only file with that letters.
- After a successful extract, a tampered regular-file tree fails physical verification.
