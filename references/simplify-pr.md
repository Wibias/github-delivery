# Simplify PR

**Trigger:** An explicit request to simplify, clean up, deduplicate, or reduce unnecessary complexity in PR #N without changing behavior. This workflow is **explicit-only**. Do not activate it for an ordinary full review, a generic merge-ready request, or because the reviewer happens to notice code that could be shorter.

## Goal

Improve maintainability and reduce cognitive load while preserving the reviewed behavior exactly. **Line count is never the objective or a success metric.** A shorter result is acceptable only when it is also at least as clear, safe, testable, and maintainable as the code it replaces.

Prefer reporting **nothing worth simplifying** over manufacturing edits.

## Authority and scope

- Read `references/shared-rules.md` before acting.
- Inspect the PR comparison plus only the directly necessary adjacent code needed to prove equivalence.
- Do not expand into unrelated refactors, repository-wide cleanup, formatting churn, dependency changes, or architectural redesign.
- Simplification cannot overrule bug, security, Spec/Standards, review, CI, base-health, mutation-policy, or `ship-gate.mjs` authority.
- Code changes require a mutation mode that permits `push_code`, but the selected mode does not replace the explicit approval required below.

## Candidate pass

Look for high-confidence opportunities such as:

- proven dead or unreachable code
- redundant branches or control flow that can be expressed more directly
- wrappers, adapters, or indirection that add no policy, compatibility, lifecycle, or abstraction value
- genuinely duplicated logic whose consolidation reduces maintenance risk without increasing coupling
- obsolete compatibility paths proven unnecessary by the repository's supported versions
- native language, platform, or existing repository facilities that are behaviorally equivalent and clearer
- comments, names, or structure that obscure intent and can be clarified without changing behavior

Do not treat every code smell as an instruction to refactor. Repository conventions and the local design override generic style preferences.

For every proposed candidate, report:

1. exact file and location
2. current maintainability problem
3. bounded proposed change
4. behavior and invariants that must remain unchanged
5. realistic risk level
6. focused validation that would prove the change safe

Keep candidates separate from bugs, vulnerabilities, spec violations, and required review fixes. Those are handled by the normal review workflows and must not be disguised as optional simplification.

## Rejection boundary

Reject a candidate when it could:

- change public or internal behavior, APIs, accepted inputs, return values, errors, logging, ordering, concurrency, timing guarantees, performance contracts, output, UI, persistence, compatibility, or side effects
- remove or weaken validation, error handling, tests, security controls, authorization, CI, evidence collection, auditability, stale-head checks, or fail-closed behavior
- make code shorter but denser, more surprising, or harder to debug
- merge responsibilities that should remain independently understandable or testable
- introduce a speculative abstraction, generic helper, dependency, or pattern without demonstrated reuse
- increase coupling merely to deduplicate a small amount of straightforward code
- rely on uncertain equivalence, incomplete repository context, or validation that cannot exercise the affected behavior
- cross the PR scope for cosmetic consistency

When uncertain, leave the code unchanged and explain why the candidate was skipped.

## Approval gate

If no worthwhile candidates remain, report **nothing worth simplifying** and return control to the calling workflow.

If candidates remain:

1. Present the complete bounded candidate list before editing.
2. Wait for **explicit approval** of all or selected candidates.
3. Do not interpret approval of the original full review, permission to fix bugs, or a broad maintainer mutation mode as approval to simplify.
4. Record which candidates were approved and apply only those candidates.

For a combined full-review request, this approval is the only continuation gate. Once approval is given, automatically continue through implementation, validation, full re-review, and final verdict. Do not ask a second continuation question.

## Application and rollback

- Apply approved candidates in small, independently attributable changes.
- Preserve existing tests and add or strengthen tests when equivalence is not already directly covered.
- Run the candidate's focused validation immediately after applying it.
- If focused validation fails or reveals changed behavior, revert that candidate individually before continuing. Do not keep a weaker approximation merely because it removes more code.
- Stop and report a blocker if independent rollback is not safe or the working tree contains unrelated changes.

## Validation

After all approved candidates pass focused validation:

1. run the repository's relevant formatter, lint, type-check, build, test, security, distribution, and other required gates
2. compare the resulting behavior and interfaces against the preserved invariants
3. push only after the required local evidence is clean
4. re-read the PR head after push and treat the new SHA as the only authoritative review target

A passing type-check or reduced diff size alone never proves behavioral equivalence.

## Mandatory full re-review

After simplification changes produce a new head, automatically run the **complete full-review workflow** from `references/full-review-pr.md` on that exact head with **simplification disabled**. The rerun includes usefulness, bug, security, Spec/Standards, human and bot feedback, base synchronization, compile/tests, required CI, thin settle, and the authoritative ship gate.

- The final verdict must be based only on the post-simplification head.
- Any regression, vulnerability, spec violation, review blocker, or failed gate introduced by simplification blocks completion and must be fixed or rolled back.
- There is no recursive simplification pass during this mandatory re-review.
- There is no second continuation prompt after the user approves the candidate list.

## Standalone completion

For a standalone simplify request, candidate approval and application are followed by the same validation and complete full-review workflow. Do not claim the PR is improved, safe, or merge-ready solely because the simplification diff looks cleaner.

## Done when

- activation was explicit
- candidates were either rejected with rationale, reported as nothing worth simplifying, or explicitly approved
- only approved behavior-preserving changes were applied
- failed candidates were reverted individually
- focused validation and all required repository gates passed
- the complete full-review workflow passed on the post-simplification head with simplification disabled
- the final verdict names the exact reviewed head and does not use reduced line count as evidence
