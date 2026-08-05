# Spec and standards review

**Trigger:** required Spec + Standards axis for full-review, make-merge-ready, and create-PR workflows.

## Goal

Review the same fixed diff through two independent questions:

- **Standards:** does the change follow this repository’s documented engineering and architectural rules?
- **Spec:** does the change implement the originating issue, PR description, plan, or specification without missing requirements or adding unjustified scope?

Do not merge the axes into one generic quality opinion. Code may satisfy the spec while violating repository standards, or follow every convention while implementing the wrong behavior.

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
- Cross-check resolution order, CLI examples, and operator docs against PR non-goals and references/shared-rules.md (Proactive contract verification).



## 3. Find the standards sources

Inspect applicable files such as:

- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`
- root and scoped `CONTEXT.md` or architecture guidance
- ADRs and documented design decisions
- language and formatting configuration such as `.editorconfig`, ESLint, Biome, Prettier, and `tsconfig.json`
- repository-specific style, testing, API, compatibility, and release documentation

Machine-enforced configuration is context, not an invitation to manually duplicate passing lint or formatting checks.

Always read `references/code-smells.md` as an advisory baseline. **Repo standards override** that baseline. Every code smell is a **judgement call**, never an automatic violation, and must be suppressed when a documented local design intentionally uses the pattern.

## 4. Run the two axes

Run the axes in parallel when the host supports isolated subagents. Otherwise run them sequentially with separate notes so one conclusion does not contaminate the other.

### Standards brief

Provide the exact diff command, commit list, and standards-source paths. Inspect the documented rules first, then the diff.

Report:

- documented standards violations with the source file and rule
- architectural or compatibility drift tied to an accepted repository decision
- possible smells from `references/code-smells.md`, clearly labelled as heuristics
- no duplicate findings for matters already enforced and passed by tooling

Distinguish hard documented violations from advisory judgement calls.

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

List findings with file or symbol, evidence, governing standard, and required action. Keep advisory smells visibly separate from hard violations. Use `none` with the sources checked when clean.

## Spec

List missing, partial, incorrect, or unrequested behavior with the supporting requirement. Use `no spec available` when appropriate rather than manufacturing a pass.

Do not merge or rerank the axes into a single list. Deduplicate only exact overlap while preserving which axis found it.

## Fix and completion rules

On merge-ready workflows, fix concrete in-scope blockers when feasible and add focused regression coverage for corrected behavior. Skip cosmetic or speculative smell suggestions that do not create a real maintenance or correctness cost.

The axis is complete only when:

- the fixed base and head are recorded
- both axes inspected the same diff
- the spec source or its absence is recorded
- the standards sources are listed
- all smell findings follow the repo-override and judgement-call rules
- docs/help were checked against explicit non-goals when the PR defines phase boundaries
- `## Standards` and `## Spec` results are available for the final verdict
