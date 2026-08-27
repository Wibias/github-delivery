<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- evidence
- git
<!-- policy-modules:end -->

# Git workflow for delivery work

**Trigger:** Organize branches or commits, prepare local Git history for a GitHub delivery workflow, inspect Git history to support delivery work, or apply commit/branch hygiene while implementing a GitHub-bound change.

## Goal

Keep local Git work safe, reviewable, reproducible, and ready for the GitHub lifecycle without delegating commit or branch discipline to another skill. This workflow does not grant remote publication, PR, merge, tag, or release authority.

## Precedence

1. `references/policy-kernel.md` and `references/policy/git.md` are authoritative safety policy.
2. Follow the repository's existing conventions for branch names, commit messages, generated files, required checks, and history shape before applying generic conventions from this reference.
3. Preserve unrelated user work. Never use a generic reset, stash, checkout, clean, or other discard operation to make the working tree convenient. If unrelated dirty work blocks the requested operation, stop and isolate the task safely.
4. Repository-specific release or contribution policy overrides examples in this document unless it would weaken a canonical `GD-*` safety rule.

## 1. Establish the Git baseline

Before mutating local history:

- identify the repository, current branch, current `HEAD`, intended base, and working-tree/index state;
- distinguish task-owned changes from unrelated user work;
- refresh the remote/base generation when the governing workflow requires current-tip evidence;
- use an isolated task branch/worktree when that is the safest way to preserve unrelated work;
- never silently rewrite, absorb, discard, or publish changes outside the requested scope.

A clean working tree is useful evidence, not permission to destroy work to obtain one.

## 2. Branch strategy

Prefer short-lived task branches that map to one coherent delivery objective. Use the repository's existing naming convention first. If no convention exists, use a concise descriptive prefix such as `feat/`, `fix/`, `refactor/`, `docs/`, or `chore/` followed by the work-item or outcome.

Do not rename an established shared branch merely to match a generic convention. Do not create a new branch when the selected workflow already owns an authorized task branch or when doing so would duplicate an existing covering PR identity.

For stacked work, conflict recovery, forks, force-with-lease, ownership, and current-tip checks, `references/policy/git.md` and `references/stacked-prs.md` remain authoritative.

## 3. Logical and atomic commits

Treat commits as durable review/recovery boundaries. Prefer commits that each represent one logical effect and can be explained, reviewed, and reverted independently where practical.

Good separation usually means:

- behavior changes are not hidden inside unrelated formatting churn;
- a refactor is separated from a new behavior when that materially improves reviewability or rollback safety;
- generated output is paired with the source change that requires it when repository convention expects both;
- tests belong with the behavior they prove unless repository practice intentionally separates them.

Do not optimize for an arbitrary line-count target or manufacture dozens of tiny commits solely to appear disciplined. `references/change-execution.md` owns broad migrations and independently verifiable change units; a useful unit does not have to map one-to-one to a commit.

When a workflow requires a content-preserving history rewrite, preserve the canonical rewrite-baseline and force-with-lease rules in `GD-GIT-008`. Never use bare force.

## 4. Commit messages

Use the repository's existing commit-message convention first. When no project convention exists, prefer a concise imperative description of the logical effect, optionally with a familiar type such as `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, or `chore:`.

A useful message answers what outcome the commit establishes. Add a body when the reason, compatibility tradeoff, security boundary, migration constraint, or non-obvious decision would otherwise be lost. Do not invent issue IDs, changelog claims, or breaking-change markers that are not supported by the change.

## 5. Pre-commit hygiene

Before a commit that is meant to be a verified checkpoint:

1. inspect the staged diff and confirm every staged path belongs to the intended logical unit;
2. check for accidental secrets/credentials using repository-native tooling and targeted inspection appropriate to the changed files;
3. run the narrowest useful tests/build/typecheck/lint/security checks required by the repository and the governing workflow;
4. confirm generated or lock files are present only when the repository expects them;
5. verify no unrelated user work was staged or modified by the operation.

Do not blindly run commands such as `npm test`, `tsc`, or a generic secret grep when the repository uses different tooling. Discover and use the repository-native contract.

## 6. Generated and ignored files

Determine generated-file handling from repository evidence: `.gitignore`, contribution/release docs, existing history, generators, package scripts, and CI contracts.

- Commit generated artifacts when the repository intentionally versions them or a release/build contract requires them.
- Do not commit ignored build output, local environment files, credentials, editor state, or generated artifacts merely because a generic template says to.
- Regenerate derived output from its canonical source rather than hand-editing it when a generator owns the representation.

## 7. Git history as delivery evidence

Use Git history tools when they answer a concrete delivery question:

- `git log` / focused diffs to establish recent intent and prior implementations;
- `git blame` to find the change that introduced or last shaped a relevant line, then inspect the commit rather than treating authorship as correctness evidence;
- `git bisect` when there is a reproducible good/bad boundary and binary search materially reduces diagnosis cost.

History is evidence about change provenance, not authority to override current code, issue scope, live GitHub state, or repository policy.

## 8. Change summary before handoff

Before PR publication or another delivery handoff, summarize from the current diff/history rather than memory:

- **Changes made:** the logical effects and important paths;
- **Intentionally untouched:** related surfaces deliberately left out, with scope reason when useful;
- **Potential concerns:** compatibility, migration, generated output, dependency, test, or operational risks that remain material;
- **Verification:** checks actually run on the current candidate head.

Do not manufacture concerns or claim absence/completeness without current evidence. `references/completion-claims.md` remains authoritative for broad completion claims.

## 9. Handoff to GitHub workflows

Local branch/commit work does not itself authorize a push or PR. When publication is requested, continue through the selected github-delivery publication workflow (`create-pr-for-issue.md`, `create-pr-from-local-work.md`, stack/backport workflow, or another exact route) and its controlled mutation boundary.

## Provenance

This reference adapts Git workflow principles from Addy Osmani's MIT-licensed `addyosmani/agent-skills` `git-workflow-and-versioning` skill, including logical commits, descriptive history, pre-commit hygiene, generated-file awareness, Git-history investigation, and human-readable change summaries. The guidance is rewritten around github-delivery's stricter dirty-work, ownership, force-with-lease, evidence, workflow, and publication contracts rather than copied as a standalone skill.
