# Resolve Conflicts During a GitHub PR Workflow

Use this reference only when the active `github-delivery` workflow encounters
Git conflicts while updating, rebasing, merging, cherry-picking, reverting, or
otherwise preparing a pull-request branch.

`github-delivery` remains the owning workflow. This reference resolves the
conflict phase only, then returns control to the workflow that invoked it.

## 1. Inspect the active operation

Determine:

- whether Git is merging, rebasing, cherry-picking, or reverting;
- the current branch, PR head, PR base, and latest base tip;
- every conflicted path;
- whether unrelated worktree or index changes are present;
- whether the active mutation mode permits modifying and continuing the branch.

Stop before modifying files when:

- the branch, base, or operation is not the expected PR operation;
- unrelated dirty changes could be overwritten or accidentally staged;
- the PR head is not writable;
- continuing would require force-pushing or another forbidden mutation;
- the intended behavior cannot be determined from available evidence.

Do not automatically abort or continue an operation merely to clear Git state.

## 2. Recover the intent of both sides

For every conflict, inspect the primary evidence for both changes:

- the conflicting commits and commit messages;
- the complete surrounding diff and relevant history;
- linked PRs, issues, review comments, and specifications;
- tests changed by either side;
- the implementation on the latest base tip;
- related producers, consumers, schemas, registries, generated outputs, and
  public representations when the conflict changes a domain concept.

Do not resolve a conflict from marker text alone.

## 3. Resolve deliberately

Preserve both intents when they are compatible.

When they are incompatible:

1. follow the explicit goal and scope of the owning PR workflow;
2. preserve current base behavior unless the PR intentionally changes it;
3. preserve the PR's intended change where it remains valid against the base;
4. do not invent unrelated behavior;
5. record any material behavior or implementation that must be discarded.

Never:

- choose `ours` or `theirs` mechanically across a file or operation;
- delete tests merely because they conflict;
- weaken validation, authorization, security, CI, or fail-closed behavior;
- widen the PR with unrelated cleanup or refactoring;
- resolve generated output without checking its authoritative source.

## 4. Validate the resolved result

After resolving every hunk:

- inspect the complete resulting diff, not only the formerly conflicted lines;
- confirm no intended base or PR changes disappeared;
- search for remaining conflict markers;
- validate generated and derived representations against their source of truth;
- run focused checks for the affected paths;
- run the build, typecheck, tests, formatting, lint, and security gates required
  by the owning workflow.

A file being accepted by Git does not prove the resolution is correct.

## 5. Continue safely

Stage only the paths resolved by this operation. Never stage unrelated changes.

Continue the merge, rebase, cherry-pick, or revert only when the active mutation
mode and user authority permit it.

Do not:

- force-push;
- create unrelated commits;
- rewrite additional history;
- mark the PR ready;
- merge the PR;
- post GitHub comments merely because the conflict is resolved.

## 6. Return to the owning workflow

After the Git operation completes, resume the original `github-delivery`
workflow.

Re-check at minimum:

- resulting diff and PR scope;
- compatibility with the latest base tip;
- required build and test gates;
- CI state;
- review comments and unresolved threads;
- stale approvals and last-push policy;
- CODEOWNERS and repository policy;
- the authoritative `ship-gate.mjs` result.

Conflict resolution never establishes merge readiness by itself.
