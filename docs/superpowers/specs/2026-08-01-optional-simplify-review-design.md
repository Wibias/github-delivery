# Optional Simplify Review Design

## Goal

Add an explicit, optional simplification phase to `shipping-github` that can be requested on its own or alongside a full PR review. The phase improves maintainability only when behavior can be preserved with high confidence. Reducing line count is never a goal by itself.

## User flow

A normal full review remains unchanged. Simplification activates only when the user explicitly asks for `simplify`, `cleanup`, `deduplicate`, or equivalent behavior-preserving refactoring.

For a combined full-review and simplify request:

1. Run the normal full review and resolve concrete bug, security, spec, review, base, and CI blockers first.
2. Inspect the reviewed PR head for worthwhile simplification candidates.
3. If no worthwhile candidates exist, report that result and continue to the normal final verdict.
4. If candidates exist, present a bounded candidate list with locations, rationale, preserved invariants, risk, and validation plan.
5. Wait for explicit approval before changing code.
6. Apply only approved candidates.
7. Run focused validation and the repository's required gates.
8. Automatically rerun the complete full-review workflow on the new head.
9. Publish the final verdict only from the post-simplification head.

Approval resumes the remaining workflow automatically. There is no second continuation prompt and no recursive simplification pass during the mandatory re-review.

## Simplification boundary

Allowed changes include removing proven dead code, simplifying control flow, replacing redundant wrappers, consolidating genuinely duplicated logic, removing unnecessary indirection, and using an existing native or repository-standard facility when equivalence is clear.

A change is forbidden when it:

- changes public or internal behavior, APIs, errors, ordering, concurrency, performance guarantees, output, UI, persistence, or compatibility
- removes or weakens validation, error handling, tests, security checks, CI, authorization, evidence, or fail-closed behavior
- makes code shorter but harder to understand
- introduces broader coupling or a speculative abstraction
- crosses unrelated scope
- depends on uncertain equivalence or insufficient validation

Each applied candidate is independently attributable and must be reverted individually if its focused validation fails. The workflow must prefer reporting `nothing worth simplifying` over manufacturing edits.

## Architecture

`references/simplify-pr.md` owns the simplification method and standalone route. `references/full-review-pr.md` composes it as an explicit opt-in phase. `SKILL.md` exposes the route and hard boundaries. Contract tests in `tests/unit/final-roadmap-acceptance.test.mjs` prevent silent weakening or accidental default activation.

## Final authority

Simplification never overrides the normal bug, security, spec, review, CI, or ship-gate authority. The final verdict is based exclusively on the fully re-reviewed post-simplification head.