# Property, invariant, state-machine, fuzz, and fault verification routing

Prose review is not always the strongest way to verify a behavior. Route selected high-risk bug/security shapes to executable verification methods when the repository can support them.

The deterministic planner is `scripts/lib/verification-method-routing.mjs`. A CLI wrapper is available at `scripts/verification-methods.mjs` for a captured review-scope plan.

## Routing

- Parsing, serialization, boundary, input-shape, or malformed-input signals route to **property-based** and **fuzz** verification.
- Concurrency, retry/idempotency, state consistency, filesystem atomicity, and resource-lifecycle signals route to **invariant** and **state-machine** verification.
- Retry, filesystem, cancellation, and error-propagation signals also route to **fault injection**.
- Recursion/termination probes route to **property-based** plus **bounded-generative** checks.
- Authz, business-logic, storage, and crypto/session security domains route to invariant verification.

## Depth semantics

- Baseline depth creates no expensive executable obligation by itself.
- Targeted depth marks routed methods as `recommended`.
- Deep bug or full security depth marks routed methods as `required-when-feasible`.

`required-when-feasible` is not permission to invent evidence. If the project has no suitable test harness/library/runtime, record the limitation and complete the strongest available deterministic/manual verification.

## Safety

This routing is defensive verification of authorized code/fixtures. It does not authorize a red-team campaign, production attack traffic, third-party probing, or installing arbitrary testing tools. The optional adversarial/red-team path remains explicit-user-request only.

## Evidence

For every executed method, preserve enough evidence to answer:

- which lens/domain/probe routed the method;
- which invariant/property/input generator was tested;
- whether the test first reproduced or could have detected the defect;
- exact command/test target where applicable;
- pass/fail and relevant minimized failing input;
- limitations, nondeterminism, or untested partitions.

The goal is stronger proof, not extra test volume. Prefer the smallest executable check that distinguishes correct from incorrect behavior.
