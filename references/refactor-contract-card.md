# Simplification / refactor contract card

Before applying a non-trivial simplification candidate, state what must remain true and prove the proposed validation actually protects it.

The machine evaluator is `scripts/lib/refactor-contract-card.mjs`.

## Required dimensions

Every candidate must explicitly preserve:

- user-visible and domain behavior;
- public/internal APIs and data formats;
- persistence and migration behavior;
- performance and resource constraints;
- security and authorization boundaries;
- supported compatibility;
- observable errors and logs;
- side effects and their count/order;
- timing/concurrency/locking semantics.

Use a concrete statement such as “no persistence occurs on this path” when a dimension is intentionally absent. An empty dimension means the equivalence analysis is incomplete.

## Test honesty

For every test/check relied on by the candidate, answer:

> Would this check fail if the protected behavior were actually broken?

If not, it does not count as evidence. Avoid vacuous assertions, implementation-mirroring tests, incidental formatting assertions, or checks that pass before and after the defect.

## Characterization

When current behavior is important but poorly documented or weakly tested, capture characterization evidence **before** restructuring it. This can be an executable test, controlled fixture, golden result, API snapshot, or another deterministic observation that records the behavior being preserved.

## Unknowns

Any unresolved equivalence question blocks application. Do not turn uncertainty into a candidate merely because the structural change looks cleaner.

## Example shape

```json
{
  "candidateId": "SIM-3",
  "behavior": ["same route result for every existing profile"],
  "apiAndData": ["no request/response schema changes"],
  "persistence": ["no persisted state on this path"],
  "performanceAndResources": ["no additional filesystem reads"],
  "securityAndAuthorization": ["same mutation authority checks"],
  "compatibility": ["Node 22/24 behavior unchanged"],
  "errorsAndLogs": ["same typed error and observable log semantics"],
  "sideEffects": ["same GitHub mutation count and order"],
  "timingAndConcurrency": ["same head/lock ordering"],
  "tests": [
    {
      "id": "route-contract",
      "protects": "same route result for every existing profile",
      "wouldFailIfBroken": true
    }
  ],
  "unknowns": []
}
```

Line-count reduction is never a contract dimension or a success metric.
