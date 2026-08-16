# Minimal solution selection

Use this companion before implementing a non-trivial fix, feature, or refactor when more than one credible solution shape exists. It is a solution-selection discipline, not a demand for fewer lines and not permission to skip repository understanding.

## Goal

Choose the smallest solution that completely satisfies the current contract while preserving repository standards, security, validation, accessibility, compatibility, observability, and required evidence.

A small solution in the wrong place is not minimal. Trace the real call/data flow first, then choose the highest applicable rung below.

## The ladder

Stop at the first rung that fully satisfies the requirement:

1. **No new behavior is needed.** The request is already satisfied, obsolete, duplicate, or can be solved by removing an unnecessary path. Prove that before doing nothing.
2. **Reuse an existing repository capability.** Prefer an established helper, module, configuration surface, script, pattern, or owning boundary when it already expresses the required behavior without widening coupling.
3. **Use the language/runtime standard library.** Prefer maintained built-ins over repository-owned reimplementations when semantics and supported versions match.
4. **Use the native platform.** Prefer browser, operating-system, database, protocol, GitHub, or framework-native behavior when it already owns the contract.
5. **Use an already-installed dependency.** Reuse an existing dependency when it provides the required behavior with lower ownership cost than custom code.
6. **Write the minimum custom implementation.** Add only the code and structure required by the current contract and its credible failure modes.

Do not add a new dependency merely because it is shorter to call. New dependency cost includes supply-chain exposure, update burden, compatibility, bundle/runtime cost, and another external contract to understand.

## Understand before choosing

Before selecting a rung:

- read the changed/owning code and every materially affected caller or consumer needed to understand the path;
- identify the authoritative contract, existing repository vocabulary, and relevant ADR/standards decisions;
- for a bug, identify the root cause rather than optimizing a symptom patch;
- identify trust, persistence, concurrency, performance, compatibility, and public-surface constraints that can invalidate an apparently smaller solution;
- search for existing repository facilities by behavior/domain concept, not only by the user's wording.

Do not turn the ladder into a repository-wide research project. Stop when the evidence is sufficient to choose among credible solutions.

## Reuse boundary

Existing code is reusable only when it already owns the same semantic responsibility. Do not create distant coupling merely to avoid a few local lines.

Reject reuse when it would:

- give a shared helper a second unrelated responsibility;
- cross an architectural or domain boundary only for deduplication;
- expose internal implementation detail through a new public interface;
- require compatibility or configuration machinery larger than the local implementation;
- weaken a clearer owner merely because another file contains similar syntax.

## Required-complexity boundary

Never simplify away:

- validation at an owning trust boundary;
- authorization, security, privacy, or integrity controls;
- error handling that prevents data loss or misleading success;
- required accessibility behavior;
- supported compatibility contracts;
- lifecycle, cleanup, ordering, transaction, locking, or concurrency guarantees;
- observability or audit evidence required by repository policy;
- tests/checks that protect a real stable behavior contract.

If the smallest correct solution needs more code than a fragile shortcut, choose the correct solution.

## Implementation record

For a material solution choice, be able to state briefly:

- **Need:** why a change is required.
- **Chosen rung:** repository reuse | stdlib/runtime | native platform | installed dependency | custom.
- **Rejected lower-cost-looking option:** only when one was plausible, with the concrete contract it failed.
- **Ownership:** which boundary now owns the behavior.
- **Verification:** the smallest stable check that proves the requirement.

Do not manufacture alternatives solely to fill this record.

## Relationship to other companions

- `references/design-quality.md` reviews whether a changed design imposes avoidable complexity after a solution exists. This file helps choose the solution shape before or during implementation.
- `references/simplify-pr.md` is explicit-only and behavior-preserving. It may use this ladder to identify an equivalent repository/stdlib/native replacement, but line count is never success evidence.
- `references/change-execution.md` governs broad migrations after a solution shape is selected.
- `references/regression-first.md` and `references/verification-boundaries.md` govern bug-fix evidence and the stable surface used to prove the result.

## Provenance

This companion adapts the solution-selection ladder from Dietrich Gebert's MIT-licensed `ponytail` project. GitHub Delivery intentionally drops line-count optimization and always-on "lazy" behavior, and rewrites the idea around repository ownership, evidence, compatibility, and fail-closed delivery constraints.
