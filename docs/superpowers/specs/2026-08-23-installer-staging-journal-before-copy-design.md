# Installer staging journal before copy

## Status

Approved 2026-08-23. Branch from current `origin/main`. GD-AUDIT-043 leftover after PR #355 only.

## Problem

PR #355 journals restore and stops truncating the live journal. Apply still copies into staging before the first journal entry. Recovery still promotes a unique `.github-delivery-staging-*` directory when the target is absent and no journal exists.

A fresh install that dies during `cpSync` can therefore leave a partial staging tree with no journal. Restart recovery treats that tree as a completed installation.

## Approach

1. Write a `staging` journal, including expected source file digests, before the copy starts.
2. After the copy, verify staging against those digests, then mark the journal `staged`. Later displace phases keep the same expected files.
3. Promote staging only when the journal phase is `staged`, `displacing`, or `displaced` and the tree matches the expected digests.
4. Never promote a staging directory that has no journal, or one whose journal is still `staging`.
5. `restoreOnFailure: false` leaves the copy crash in place so tests can model process death. Normal failures still clean staging.

Do not change Authority cutover, lock policy, or source identity.

## Tests

- Recover does not install a unique staging directory when there is no journal.
- A killpoint during a fresh installation copy leaves a `staging` journal; recover does not make that partial tree the live target; a later apply still succeeds.
- An unreadable journal after displace does not promote unverified staging; a later apply still succeeds.
