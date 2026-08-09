# P2 correctness and resilience hardening

Audit baseline: `d5137472eafb660c18306d28484f6850aeab6ac4`

Stack base: P1 head `08c013850751d5999e05a7853ece86195b12bbd7`

## Scope and order

1. Qualify stacked-PR topology by repository identity plus ref name; fork branches with the same name must remain distinct.
2. Add a repository-wide negative mutation-boundary check so new production GitHub writes cannot bypass the broker.
3. Add transaction retry/crash coverage so a merge followed by process failure cannot duplicate merged-only social effects.
4. Add concurrent idempotency coverage for social writes using the same idempotency key.
5. Fail closed on unknown future GitHub enum/state values rather than silently treating them as safe.
6. Strengthen merge-queue workflow coverage so required GitHub Actions checks have verified `merge_group` producers when queues are enabled.
7. Harden the live GitHub fixture boundary toward a dedicated, explicitly configured fixture repository and least-privilege credentials.

## Acceptance

- [ ] Stack graph keys include repository identity and branch name.
- [ ] Two forks may use the same branch name without false duplicate-head failure.
- [ ] A fork branch named like an upstream stack parent cannot create a false parent edge.
- [ ] Production direct GitHub mutations outside approved broker/fixture boundaries fail repository validation.
- [ ] Merge retry after an already-completed merge does not duplicate merged-only thank-you/cleanup effects.
- [ ] Concurrent same-key social mutation tests prove at-most-once remote effect or fail closed.
- [ ] Unknown GitHub state/enum values produce `unknown`/blocked behavior, never ready-by-default.
- [ ] Merge-queue required-check producer mapping is verified or the gate remains unknown.
- [ ] Live fixture execution requires an explicitly identified fixture repository separate from the repository under test unless an explicit local override is set.
- [ ] Focused tests are written RED before each production change.
- [ ] Full Node 22/24 Linux/macOS/Windows validation, Dependency Review, and CodeQL pass.
