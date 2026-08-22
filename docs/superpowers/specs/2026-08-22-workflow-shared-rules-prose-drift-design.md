# Workflow shared-rules prose drift (GD-AUDIT-009 remaining)

## Status

Approved 2026-08-22 as gen40 leftover GD-AUDIT-009 (numbering-conflict lineage, not first-wave PR 102). Branch from current `origin/main`.

## Problem

Policy modules already exist and `shared-rules.md` is a compatibility index. Routed workflows, compact review contract, and Cursor overrides still tell agents to load `shared-rules.md` as mandatory context, to settle from it, or to follow it as a detail source. That reintroduces the monolith through prose even when the policy-bundle declaration is correct.

This does not reopen first-wave 009 (policy-module extraction) or gen40 003/004/011.

## Approach

1. Keep `shared-rules.md` as a compatibility index. Do not load it as mandatory workflow context.
2. Replace remaining load/follow/settle/detail pointers with the declared kernel and the matching `references/policy/*.md` modules.
3. Allow one explicit prohibition: `Do not load \`references/shared-rules.md\` as mandatory context`.
4. Leave eval `shared-rules-read` assertion fixtures for 011 unless those tests are migrated in the same change.

## Tests

- A scan of routed workflows plus compact-review/override extras fails if they still mention `shared-rules.md` (except the allowed prohibition) or the old shared-rules docs-only settle phrase.
