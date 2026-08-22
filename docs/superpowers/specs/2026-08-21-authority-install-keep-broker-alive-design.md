# Keep Authority broker alive if install-release fails

## Status

Approved 2026-08-22 (Wave 3, GD-AUDIT-048 only). Branch from current `origin/main`. Do not bundle 049 or skill rollback.

## Problem

`install-release.ps1` `Stop-Process`es a healthy `GitHubDeliveryAuthority` before staging the new tree. A failed `Copy-Item` (or later cutover) never reaches `Start-Process`, so the broker stays offline.

## Approach

Copy into staging first. Stop the running broker only after that copy succeeds. Remember `$previousExe`. On `catch` after a stop, start `$previousExe` if it still exists, then rethrow. Keep `-SkipStart` from starting either process.

Do not change Registry vs Startup-folder autostart (049).

## Tests

- `Copy-Item` into staging appears before `Stop-Process` in the installer.
- A `catch` restarts `$previousExe` before rethrowing.
