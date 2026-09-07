<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- evidence
- reviews
<!-- policy-modules:end -->

# Spec and standards review

**Trigger:** required Spec + Standards axis for full-review, make-merge-ready, and create-PR workflows.

## Goal

Review the same fixed diff through two independent questions:

- **Standards:** does the change follow this repository’s documented engineering and architectural rules?
- **Spec:** does the change implement the originating issue, PR description, plan, or specification without missing requirements or adding unjustified scope?

Do not merge the axes into one generic quality opinion. Code may satisfy the spec while violating repository standards, or follow every convention while implementing the wrong behavior.

Applicable code-smell, design-quality, and type-evidence observations remain **advisory** unless another repository rule, Bug, Security, Spec, or safety-invariant consequence makes them binding. Summarize those observations separately as **Code quality** so a reviewer can see material maintainability/testability concerns without confusing them with hard Standards violations. This is a reporting view over the existing lenses, not a third review engine or a third authority axis.

## 1. Pin one comparison

For an existing PR, use its actual base branch and checked-out head. Record the exact refs and run the merge-base comparison:

```bash
git diff <base>...<head>
git log <base>..<head> --oneline
```

Do not append base metadata to a subagent field that has its own strict schema. The comparison state belongs in the review brief and local checkout, not inside unrelated adapter fields such as Cursor Bugbot’s `Diff:` value.

For a local branch without a PR, use the fixed point supplied by the user. When none was supplied, use the repository default branch unless that would clearly review the wrong work, then ask once for the intended fixed point.

Capture the diff command and commit list once. Both axes must inspect the same comparison.

## 2. Find the spec source

Use this order:

1. Linked issue or PR body and any issue references in the commits.
2. A spec, plan, or path supplied by the user.
3. A matching document under `docs/`, `specs/`, `.scratch/`, or another repository-defined planning directory.
4. Explicit acceptance criteria in tests or fixtures when they clearly represent the originating contract.

When no spec exists, report `no spec available` under `## Spec`. Do not invent requirements from taste, convention, or what the implementation happens to do.

### Docs vs non-goals (feature PRs)

When the issue/PR lists explicit **non-goals** (e.g. dry-run only, no production routing yet, no live enforcement):

- User-facing docs added/changed in the PR must not imply behavior beyond those non-goals.
- Flag doc drift as a **Spec** blocker on merge-ready paths (e.g. docs read like production routing is live when the PR says dry-run only).
- Cross-check resolution order, CLI examples, and operator docs against PR non-goals and `references/policy/reviews.md` (GD-REVIEW-008 Proactive contract verification).
- Also cross-check **docs vs implemented behavior**: any documented config key, CLI flag, output metric, or scoring weight that the code does not consume/emit is a no-op or over-claim — either the code must consume it or the docs must label it future/non-goal. **Scoring/weight tables especially:** when a table lists weights or dimensions the evaluator does not score independently (because it folds normalized inputs into one composite or treats them as accepted-but-inactive), the docs must match the implemented behavior — document the fold, mark the entry reserved/future, or implement the dimension. An accepted-but-inactive weight documented as active is a Spec blocker.

<!-- assertion-anchors -->
<!-- assertion: accepted-but-inactive-weight-docs-overclaim -->
<!-- assertion: docs-label-future-or-implement -->
<!-- assertion: scoring-weight-table-matches-implementation -->
<!-- /assertion-anchors -->

## 3. Find the standards sources

Inspect applicable files such as:

- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`
- root and scoped `CONTEXT.md` or architecture guidance
- ADRs and documented design decisions
- language and formatting configuration such as `.editorconfig`, ESLint, Biome, Prettier, and `tsconfig.json`
- repository-specific style, testing, API, compatibility, and release documentation

Machine-enforced configuration is context, not an invitation to manually duplicate passing lint or formatting checks.

Always read `references/code-smells.md` as an advisory baseline. **Repo standards override** that baseline. Every code smell is a **judgement call**, never an automatic violation, and must be suppressed when a documented local design intentionally uses the pattern.

When the diff changes executable behavior, architecture, domain/state modeling, concurrency, or non-trivial control flow, also read `references/design-quality.md`. That companion is advisory: use its happy-path, boundary, abstraction-cost, domain-model, and state-ownership lenses only when the changed code shows a concrete maintenance, correctness, testability, or operational cost. Repository standards still override it. For docs-only, generated-only, lockfile-only, or other changes with no relevant design surface, record the design-quality lens as `n/a` instead of inventing a finding.

When the diff changes TypeScript or typed JavaScript and the changed path carries meaningful compile-time or runtime type evidence, also read `references/type-evidence-review.md`. Use it to trace evidence creation, loss, and re-establishment across assertions, widening, reflective access, internal broad contracts, and tests that may mock away the production wiring they claim to verify. It is repository-aware and advisory unless the same evidence proves a Bug, Security, Spec, safety-invariant, or documented-standards violation. Do not apply blanket bans on `unknown`, `typeof`, assertions, reflection, or mocks. For non-JS/TS changes, untyped JavaScript with no material type contract, generated-only code, or changes with no relevant type-evidence surface, record the type-evidence lens as `n/a`.

## 4. Run the two axes

Run the axes in parallel when the host supports isolated subagents. Otherwise run them sequentially with separate notes so one conclusion does not contaminate the other.

### Standards brief

Provide the exact diff command, commit list, and standards-source paths. Inspect the documented rules first, then the diff.

Report:

- documented standards violations with the source file and rule
- architectural or compatibility drift tied to an accepted repository decision
- possible smells from `references/code-smells.md`, clearly labelled as heuristics
- material design-quality observations from `references/design-quality.md`, clearly labelled advisory unless another repository rule independently makes them binding
- material type-evidence observations from `references/type-evidence-review.md`, including the strongest evidence before the questionable step, what weakened or bypassed it, and whether a credible proof re-establishes the claimed contract
- no duplicate findings for matters already enforced and passed by tooling

Distinguish hard documented violations from advisory judgement calls. When a design-quality or type-evidence observation reveals a real bug, vulnerability, spec violation, or material unproven safety invariant, hand it to the governing axis/companion rather than reporting the same concern twice under Standards.

### Spec brief

Provide the same diff command and commit list plus the spec source.

Report:

- requirements missing or only partially implemented
- behavior added without support in the spec or issue
- requirements that appear implemented but whose behavior contradicts the source
- acceptance criteria lacking credible verification
- docs or user-facing help that overclaim current behavior (for example future-phase routing described as production-ready)
- explicit non-goals or phase boundaries violated by docs, CLI help, or API contracts
- new CLI/API surfaces whose docs omit required steps, flags, or limitations stated in the issue/PR non-goals

Cite the relevant requirement or state that the source provides no such requirement.

When the PR states non-goals (for example "dry-run only", "no production routing yet"), **read docs and help text against those non-goals**, not only against the happy-path implementation.

## 5. Aggregate without masking

Use these headings in chat and in the full-review verdict evidence:

## Standards

List hard documented-standard findings with file or symbol, evidence, governing standard, and required action. Use `none` with the sources checked when clean. Do not hide advisory design/code-smell/type-evidence observations inside this hard-violation list.

## Spec

List missing, partial, incorrect, or unrequested behavior with the supporting requirement. Use `no spec available` when appropriate rather than manufacturing a pass.

## Code quality

Summarize only material advisory observations from `references/code-smells.md`, `references/design-quality.md`, and applicable `references/type-evidence-review.md` evidence:

- `clean` when the applied lenses found no material maintenance/testability/reader-cost issue;
- `n/a — <reason>` when the changed surface has no meaningful code-quality lens (for example docs-only/mechanical-only);
- otherwise list the concrete location, lens/smell, cost, and smallest bounded correction.

Keep the authority explicit: `advisory` unless another axis independently makes the same evidence binding. Do not turn taste, theoretical refactoring, or tooling-enforced style into a quality finding. When a material observation is actionable, classify it through `references/review-finding-triage.md` rather than assuming every true observation requires code change.

Do not merge or rerank Spec and Standards into a single list. `Code quality` is a compact visibility layer over the existing advisory lenses; it does not change the authority of either axis. Deduplicate exact overlap while preserving which governing axis, if any, makes an observation binding.

## Fix and completion rules

On merge-ready workflows, fix concrete in-scope blockers when feasible and add focused regression coverage for corrected behavior. Apply `references/review-finding-triage.md` to material advisory findings before changing code. Skip cosmetic or speculative smell/design/type-evidence suggestions that do not create a real maintenance or correctness cost.

The axis is complete only when:

- the fixed base and head are recorded
- both axes inspected the same diff
- the spec source or its absence is recorded
- the standards sources are listed
- all smell findings follow the repo-override and judgement-call rules
- the design-quality companion was applied where relevant or explicitly recorded `n/a`
- the type-evidence companion was applied where relevant or explicitly recorded `n/a`
- docs/help were checked against explicit non-goals when the PR defines phase boundaries
- `## Standards`, `## Spec`, and `## Code quality` results are available for the final verdict
