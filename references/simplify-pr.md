<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- reviews
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Simplify PR

**Trigger:** An explicit request to simplify, clean up, deduplicate, or reduce unnecessary complexity in PR #N without changing behavior. This workflow is **explicit-only**. Do not activate it for an ordinary full review, a generic merge-ready request, or because the reviewer happens to notice code that could be shorter.

## Goal

Improve maintainability and reduce cognitive load while preserving the reviewed behavior exactly. **Line count is never the objective or a success metric.** A shorter result is acceptable only when it is also at least as clear, safe, testable, and maintainable as the code it replaces.

Prefer reporting **nothing worth simplifying** over manufacturing edits.

## Authority and scope

- Read `references/shared-rules.md` before acting.
- Read `references/refactor-contract-card.md` before proposing or applying non-trivial candidates.
- Inspect the PR comparison plus only the directly necessary adjacent code needed to prove equivalence.
- Do not expand into unrelated refactors, repository-wide cleanup, formatting churn, dependency changes, or architectural redesign.
- Simplification cannot overrule bug, security, Spec/Standards, review, CI, base-health, mutation-policy, or `ship-gate.mjs` authority.
- Code changes require a mutation mode that permits `push_code`, but the selected mode does not replace the explicit approval required below.
- **PR ownership (shared rules):** only PRs authored by the authenticated user may be edited and pushed. On a foreign PR, run the candidate pass but apply nothing; deliver the complete bounded candidate list to the PR owner (verdict for full-review composition; comment or chat for standalone) and skip the approval-to-apply, validation, push, and re-review flow.

## Candidate pass

Look for high-confidence opportunities such as:

- proven dead or unreachable code
- redundant branches or control flow that can be expressed more directly
- wrappers, adapters, or indirection that add no policy, compatibility, lifecycle, or abstraction value
- genuinely duplicated logic whose consolidation reduces maintenance risk without increasing coupling
- obsolete compatibility paths proven unnecessary by the repository's supported versions
- native language, platform, or existing repository facilities that are behaviorally equivalent and clearer
- comments, names, or structure that obscure intent and can be clarified without changing behavior

### Readability, vocabulary, and state lenses

Also inspect for:

- inconsistent vocabulary: one concept has multiple names, or one name represents multiple concepts
- names that repeat context already supplied by the module, type, namespace, or owning object
- comments that restate visible code, narrate the PR or conversation, or depend on implementation history to make sense
- missing comments or documentation for non-obvious constraints, lifecycle rules, side effects, or failure behavior that the code cannot express clearly on its own
- primary behavior buried beneath low-level helpers when repository conventions support a clearer reading order
- stored, passed, cached, or synchronized state that is safely derivable from an existing authoritative value
- aliases, adapters, fallback formats, old signatures, or compatibility paths introduced and superseded entirely within the same unmerged PR
- names, comments, or structure that a reader cannot understand without reading the issue, conversation, or commit history
- existing repository utilities or abstractions that already express the same operation more clearly without widening coupling

Treat these as candidate signals, not automatic edits. Prefer the clearest established repository or domain term over shorter but less precise vocabulary. Do not shorten names, derive state, remove compatibility, reorder files, replace local code with shared utilities, or combine concepts unless the resulting behavior and relevant invariants can be proven equivalent.

For derivable state, explicitly check whether recomputation would alter performance, timing, snapshot semantics, consistency boundaries, or side effects. For branch-local compatibility, prove that the superseded form was never shipped, persisted, externally consumed, or relied on by fixtures, generated artifacts, downstream branches, or tests.

Do not treat every code smell as an instruction to refactor. Repository conventions and the local design override generic style preferences.

For every proposed candidate, report:

1. exact file and location
2. current maintainability problem
3. bounded proposed change
4. behavior and invariants that must remain unchanged
5. realistic risk level
6. focused validation that would prove the change safe
7. contract-card result from `references/refactor-contract-card.md`

Keep candidates separate from bugs, vulnerabilities, spec violations, and required review fixes. Those are handled by the normal review workflows and must not be disguised as optional simplification.

## Contract-card gate

Before a non-trivial candidate can be offered for approval or applied, build its contract card and evaluate it with `scripts/lib/refactor-contract-card.mjs` (or the equivalent host integration).

The card must explicitly preserve behavior, API/data shape, persistence, performance/resources, security/authorization, compatibility, observable errors/logs, side effects, and timing/concurrency semantics. State an explicit "no such effect on this path" contract when a dimension genuinely does not apply; an empty dimension means the analysis is incomplete.

Every relied-on test/check must state whether it would fail if the protected behavior were broken. A check that would still pass is vacuous and does not count as equivalence evidence.

When important current behavior is poorly documented or weakly tested, capture characterization evidence **before** restructuring it. Any unresolved equivalence unknown blocks the candidate.

Only `eligible: true` candidates may proceed to the approval gate. A failed contract-card evaluation means leave that candidate unchanged and report the blocker.

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

1. Present the complete bounded candidate list before editing, including each eligible contract-card summary.
2. Wait for **explicit approval** of all or selected candidates.
3. Do not interpret approval of the original full review, permission to fix bugs, or a broad maintainer mutation mode as approval to simplify.
4. Record which candidates were approved and apply only those candidates.

On a foreign PR this gate is skipped: candidates are delivered to the PR owner instead of being applied.

For a combined full-review request, this approval is the only continuation gate. Once approval is given, automatically continue through implementation, validation, full re-review, and final verdict. Do not ask a second continuation question.

## Application and rollback

- Foreign PRs: nothing is applied or pushed; the bounded candidate list goes to the PR owner.
- Apply approved candidates in small, independently attributable changes.
- Preserve existing tests and add or strengthen tests when equivalence is not already directly covered.
- Run the candidate's focused validation immediately after applying it.
- If focused validation fails, reveals changed behavior, or shows that a claimed test was vacuous, revert that candidate individually before continuing. Do not keep a weaker approximation merely because it removes more code.
- Stop and report a blocker if independent rollback is not safe or the working tree contains unrelated changes.

## Validation

After all approved candidates pass focused validation:

1. run the repository's relevant formatter, lint, type-check, build, test, security, distribution, and other required gates
2. compare the resulting behavior and interfaces against every preserved contract-card dimension
3. confirm the relied-on tests/checks still protect the stated behavior rather than merely passing for unrelated reasons
4. push only after the required local evidence is clean
5. re-read the PR head after push and treat the new SHA as the only authoritative review target

A passing type-check, passing-but-vacuous test, or reduced diff size alone never proves behavioral equivalence.

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
- every non-trivial applied candidate had an eligible contract card with no unresolved equivalence unknowns
- relied-on tests/checks were shown to fail when their protected behavior is broken, or were strengthened before use
- important poorly documented behavior had characterization evidence before restructuring
- on foreign PRs: the bounded candidate list was delivered to the PR owner and nothing was edited or pushed
- only approved behavior-preserving changes were applied
- failed candidates were reverted individually
- focused validation and all required repository gates passed
- the complete full-review workflow passed on the post-simplification head with simplification disabled
- the final verdict names the exact reviewed head and does not use reduced line count as evidence