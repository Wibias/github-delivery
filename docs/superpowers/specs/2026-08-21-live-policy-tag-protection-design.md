# Live policy protected tag pattern

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-053 only). Branch from current `origin/main`. Do not bundle 052, installer `dist` ENOENT, hook fail-open, or bypass-attestation work.

## Problem

Checked-in policy requires `release.protectedTagPattern: "v*"`. Live GitHub has Protect release tags (ruleset 20972149: deletion, non_fast_forward, update, empty bypass). The live policy evaluator never reads tag rulesets, so Repository Policy CI can stay green if that ruleset is deleted or retargeted.

## Approach

Fetcher lists repository rulesets, GET-completes those with `target: "tag"`, and passes `tagRulesets` plus `tagRulesetsComplete`.

Evaluator, when the declared pattern is present:

1. Missing or incomplete tag-ruleset evidence → `protected_tag_evidence_incomplete`
2. No active tag ruleset whose include list covers `v*` or `refs/tags/v*` (also `~ALL`) → `protected_tag_pattern_missing`
3. A covering ruleset that lacks `deletion`, `non_fast_forward`, and `update` → `protected_tag_rules_missing`

Do not change `boundedSpawnSync` shell policy. Do not fold tag bypass into the 050 branch-bypass path in this PR.

## Tests

- Happy-path `matchingLive()` includes a covering active tag ruleset so existing valid cases stay valid
- Missing `tagRulesetsComplete` → incomplete
- Complete empty list → pattern missing
- Active ruleset for another pattern → pattern missing
- Covering pattern without deletion/non_fast_forward/update → rules missing
- `refs/tags/v*` include matches declared `v*`
