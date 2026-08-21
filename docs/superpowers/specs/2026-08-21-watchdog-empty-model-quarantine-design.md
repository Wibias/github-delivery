# Watchdog empty-model quarantine matching

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-055 only). Branch from current `origin/main`. Do not bundle 060–062, 065–067, 069, or SessionEnd quarantine lifetime.

## Problem

`sameModel` treats an empty quarantined model or an empty current model as a wildcard (`!quarantinedModel || !currentModel || equal`). A protocol stall that recorded `model: ""` therefore blocks every later `UserPromptSubmit`, including a real model change. Documented recovery is "change model or start a new task." SessionEnd keeps the quarantine file, so the wildcard stays sticky.

A missing current `model` must not clear a named quarantine (omitting the field would otherwise evade the block).

## Approach

- Empty quarantined model + named current model → not the same model (allow the documented change-model recovery and clear quarantine).
- Named quarantined model + empty current model → still the same (fail closed).
- Both empty → still the same (fail closed).
- Both named → string equality, as today.

Do not delete protocol quarantine on SessionEnd. Do not change 054/056/057 stop reasons.

## Tests

- Stall without `model`, then `UserPromptSubmit` with `working/model` is not blocked.
- Named quarantine still blocks `UserPromptSubmit` that omits `model`.
