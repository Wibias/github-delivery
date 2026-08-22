# Policy-bundle mandatory context (GD-AUDIT-011 remaining)

## Status

Approved 2026-08-22 as gen40 leftover GD-AUDIT-011 (numbering-conflict lineage, not first-wave PR 104). Branch from current `origin/main` after 009.

## Problem

009 removed leftover shared-rules load prose from workflows. Three machine checks were still missing:

1. `policy-bundle --validate` did not fail if a routed workflow started telling agents to load `shared-rules.md` again.
2. Offline evals still listed `references/shared-rules.md` as expected context, so progressive-disclosure cases dual-loaded the compatibility index plus the declared bundle.
3. The 60% context budget only covered `SKILL.md` and SKILL+kernel. Per-workflow SKILL+kernel+declared-module payloads were unenforced.

This does not reopen first-wave 011 (merge thank-you ordering) or gen40 003/004/009.

## Approach

1. Reject leftover shared-rules load/settle/detail phrases inside `validatePolicyArchitecture`.
2. Measure each routed workflow's policy payload as SKILL + kernel + unconditional modules, and require the same 60% reduction versus the old SKILL+monolith baseline.
3. Forbid `references/shared-rules.md` in eval `expected_resources`. Compatibility-index assertion markers remain bound without loading that file.
4. Point evals at SKILL + the routed workflow; treat the monolith as unnecessary context.

## Tests

- Architecture validation fails a fixture workflow that still says to read `shared-rules.md`.
- Architecture validation fails when a workflow policy payload misses the 60% budget.
- Repository evals reject shared-rules as an expected resource and stay bound through the compatibility index.
