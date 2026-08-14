# Stable verification boundaries

Use this companion when selecting tests or executable checks for bug fixes, refactors, or behavior-preserving changes.

The goal is to prove behavior at the **narrowest stable boundary that actually observes the contract**, rather than defaulting to the lowest-level helper or building a large end-to-end harness for every change.

## What counts as a stable boundary

A stable boundary is an interface whose behavior matters independently of the current internal implementation. Depending on the repository, that can be:

- a public/domain function or component contract;
- a controller/service/use-case entrypoint;
- a CLI command and its observable result;
- an API/IPC/persistence boundary;
- a real script or command that exercises the production path;
- a deterministic runtime/operator probe when local tests cannot represent the behavior.

"Stable" does not mean "highest level". Use the smallest boundary that remains meaningful if internals are reorganized.

## Selection rule

Choose the narrowest useful regression or characterization check that satisfies all of these:

1. it would fail if the protected behavior were actually broken;
2. it observes a stable contract rather than an incidental helper implementation;
3. it exercises the real code path as far as practical;
4. it does not require disproportionate harness, timing, fixture, or mock complexity;
5. it captures the relevant output, state, side effect, error, or ordering contract.

A focused unit test is ideal when the unit's own observable contract is exactly what failed. It is low-signal when it merely mirrors a private helper's current implementation while the real use-case could still be broken.

## Prefer behavior over implementation shape

Avoid tests whose main purpose is to preserve:

- one-line helper calls;
- private method decomposition;
- internal call counts that are not themselves a contract;
- incidental formatting or object layout;
- a copied version of the production algorithm inside the assertion;
- mock choreography that can pass while the real integration is wrong.

Lower-level tests still have value for pure algorithms, parsers, state transitions, error partitions, security invariants, or performance-sensitive code when those are stable contracts in their own right.

## Use real paths without forcing giant end-to-end tests

Prefer real repository code over elaborate internal mocks. Stub or fake an external dependency when that is the cleanest way to make the owning boundary deterministic, but keep the substitute at an actual integration seam.

Do not build a browser/service/production-like environment solely to make a small change look more realistic when a smaller stable boundary proves the same behavior. Conversely, do not retreat to a trivial unit test when only a CLI/API/runtime path can distinguish the real failure.

## Preserve observable order when order matters

When behavior depends on sequencing, retries, side-effect count/order, cleanup, locking, or lifecycle transitions, assert the **observable contract** for that order.

Examples:

- the user-visible state changes only after persistence succeeds;
- cleanup occurs after the final consumer releases a resource;
- a mutation happens once even when readback/reconciliation retries;
- an event sequence is `started -> completed` rather than testing which private helpers were called.

If order is not part of the contract, do not freeze it accidentally.

## Characterization before refactor

When important behavior is weakly documented or weakly tested, capture it before restructuring through the best stable boundary available. The check can be a test, golden result, snapshot of a public data shape, CLI/API observation, or another deterministic executable result.

A characterization check should protect behavior the refactor must preserve, not fossilize accidental implementation details.

## Mock and fixture discipline

Mocks/fixtures are evidence only when they represent the boundary faithfully enough to catch the protected failure.

Reject a proposed check when:

- the mock repeats the implementation's assumptions instead of challenging them;
- the fixture omits the field/state that triggers the real path;
- every internal collaborator is mocked, so production wiring is never exercised;
- the test would pass before and after the defect;
- setup complexity is larger than the behavior being proved without adding useful signal.

When the real external dependency cannot be used, prefer a narrow fake/fixture at its documented boundary and add a separate integration/runtime check when the risk requires it.

## Relationship to regression-first

`references/regression-first.md` decides that a confirmed bug needs broken-before/fixed-after evidence. This companion helps select **where** that evidence should observe behavior.

Use regression-first for the temporal proof. Use stable verification boundaries to avoid both extremes: brittle helper-level tests and needlessly huge end-to-end harnesses.

## Relationship to refactor equivalence

`references/refactor-contract-card.md` asks whether each relied-on check would fail if protected behavior broke. Apply this companion to make that check resilient to internal restructuring.

A green check at an unstable implementation seam is weaker equivalence evidence than a green check at a stable contract that exercises the changed behavior.

## Evidence to record

For each relied-on check, be able to state:

- **Boundary:** what stable contract it observes.
- **Protected behavior:** what would be wrong if it failed.
- **Failure sensitivity:** why it would fail if that behavior broke.
- **Real-path depth:** what production code it actually executes and what is substituted.
- **Observable:** result/state/error/side effect/order being asserted.

Do not claim stronger confidence than the selected boundary supports.

## Provenance

This reference adapts the stable use-case testing ideas from Hona's publicly shared engineering-design gist and complements the practical test-selection guidance already adapted from Cursor's MIT-licensed `pstack` `tdd` skill. The wording and evidence contract are rewritten for `github-delivery`.
