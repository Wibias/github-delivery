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

- [x] Stack graph keys include repository identity and branch name.
- [x] Two forks may use the same branch name without false duplicate-head failure.
- [x] A fork branch named like an upstream stack parent cannot create a false parent edge.
- [x] Production direct GitHub mutations outside approved broker/fixture boundaries fail repository validation.
- [x] Merge retry after an already-completed merge does not duplicate merged-only thank-you/cleanup effects.
- [x] Concurrent same-key autonomous social mutations serialize through a deterministic remote GitHub idempotency claim; a competing claim fails closed before the visible effect.
- [x] Unknown GitHub review decision values fail closed as `review_decision_unknown`; unknown check and merge outcomes remain fail-closed.
- [x] Merge-queue required GitHub Actions checks are mapped to their actual workflow runs and exact workflow sources; missing, ambiguous, or non-`merge_group` producers keep the gate unknown.
- [x] Live fixture execution requires an explicitly identified fixture repository separate from the repository under test. The same-repository override is local-only and disabled under GitHub Actions.
- [x] Fixture Git fetch/push/delete operations use a dedicated verified `github-delivery-fixture` remote rather than `origin`.
- [x] The live-integration workflow requires `LIVE_FIXTURE_REPOSITORY` and refuses the source repository as its target.
- [x] Focused tests were written RED before the production changes that closed each newly exposed bug class.
- [x] Full Node 22/24 Linux/macOS/Windows validation, Dependency Review, and CodeQL pass.

## Final verification

Implementation head before this documentation-only completion commit: `17a387abea121e478c0c644c6507013ef6fb8f65`.

At that head:

- CI run 575: success across all six Node/OS matrix jobs, including the Windows authority-host build and self-test.
- Dependency Review run 400: success.
- CodeQL run 523: success for JavaScript/TypeScript and C#.

The first integrated P2 run exposed one stale roadmap acceptance assertion that still required a literal `origin` fixture push. The production hardening was kept intact; the test was corrected to require Git authentication before the dedicated fixture remote push. The repaired implementation head then passed the complete repository gate.
