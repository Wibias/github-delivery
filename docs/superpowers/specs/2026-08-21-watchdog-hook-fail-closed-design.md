# Watchdog hook exception fail-closed

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-056 only). Branch from current `origin/main`. Do not bundle 052, 057 stale-lock fencing, installer `dist` ENOENT, or PreToolUse output-shape extras.

## Problem

Codex 0.147 treats hook exit `2` plus stderr as a block/continue control effect. Any other non-zero exit is `Failed`, and the operation proceeds.

`scripts/codex-watchdog-hook.mjs` `main()` catches parse and evaluation errors, writes stderr, and sets `process.exitCode = 1` with empty stdout. That fail-opens `Stop` and `UserPromptSubmit` (and PreToolUse) when the hook throws.

## Approach

On exception, keep the existing stderr line and set `process.exitCode = 2`. Reject arrays the same way as `null`: `typeof [] === "object"` would otherwise accept `[]` and exit 0. Do not emit stdout JSON from the catch path: PreToolUse `continue: false` fail-opens, and the documented process-boundary block is exit `2` plus stderr.

Do not change happy-path `decision: "block"` / `continue: false` shapes. Do not add PermissionRequest or PreCompact handlers. Do not change lock fencing (057).

## Tests

CLI spawn of `scripts/codex-watchdog-hook.mjs`:

- Invalid JSON stdin → status `2`, stderr mentions the hook error, stdout empty
- JSON `null` or `[]` → status `2`, stderr mentions `hook input must be a JSON object`, stdout empty
- Valid PreToolUse JSON → status `0`
