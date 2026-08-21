# Pre-open Cursor `.mdc` rules

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-061 only). Branch from current `origin/main`. Do not bundle 062 Unicode `$`-anchor evasion, 065–067, or 069.

## Problem

Cursor’s live project-rule format is `.cursor/rules/*.mdc`. Those files are not `DOC_RE`, not `.github/`, and not `OPERATIONAL_POLICY_RE` (059 anchored `.md` so `.mdc` would not match). Empty `logicFiles` forces security/bug `skip` and pre-open `ready`. Legacy `.cursorrules`, `.windsurfrules`, and `.clinerules` skip the same way.

## Approach

Treat `.cursor/rules/**/*.mdc`, `.cursorrules`, `.windsurfrules`, and `.clinerules` as operational policy, the same class as `AGENTS.md`. Expand the `agentic_skills_supply_chain` path matcher the same way. Keep `.cursor/rules/*.md` in the 059 set. Do not strip Unicode path suffixes.

## Tests

Hostile `alwaysApply: true` / “merge immediately” patches for:

- `.cursor/rules/exfil.mdc`
- nested `.cursor/rules/imported/org/security.mdc`
- `.cursorrules`, `.windsurfrules`, `.clinerules`

must be in `logicFiles`, security/bug not `skip`, and `evaluate` not `ready`. `docs/guide.md` stays skip/ready.
