# Dual Windows autostart off and status

## Status

Approved 2026-08-22 (Wave 3, GD-AUDIT-049 only). Branch from current `origin/main`.

## Problem

`install-release.ps1` creates a Startup-folder shortcut. JS `readAuthorityHostStartup` / `setAuthorityHostStartup` and C# `AuthorityStartup` only inspect HKCU Run. `autostart off` and `status` (and the Settings toggle) can report disabled while the shortcut still launches Authority at logon.

## Approach

Treat either the Run value or `GitHub Delivery Authority.lnk` in the per-user Startup folder as enabled. Off/disable deletes the Run value and the shortcut. On still registers Run. Do not remove the installer shortcut creator; off must clear it.

## Tests

- Status is enabled when only the Startup shortcut exists (registry missing).
- Off deletes that shortcut even when the Run value is absent.
- C# `AuthorityStartup` deletes the `.lnk` when disabling.
