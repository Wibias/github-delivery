<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- publication
<!-- policy-modules:end -->

# Create PR from local work

**Trigger:** “create pr”, “open a PR for these changes”, “push this and create a PR”, or equivalent publication requests where the source is already-existing local work and no issue is supplied.

## Goal

Publish exactly the intended local change as one pull request without inventing issue context or unrelated lifecycle work.

This workflow is deliberately separate from `create-pr-for-issue.md`. **Do not infer an issue.** Do not run issue research, add `Fixes`/`Closes` linkage, assign an issue, or publish an issue comment unless the user separately asks for those effects.

## Workflow

1. **Resolve local context.** Identify the repository, current branch, default/development base, working-tree state, and commits that differ from the intended base.
2. **Lock scope before staging.** Separate the work the user asked to publish from unrelated pre-existing files or commits. Preserve unrelated work. Do not use `git add -A` as a default shortcut when the working tree contains mixed scope.
3. **Prepare a clean task branch.** If work is on the default branch, create a task branch. If unrelated local commits would leak into the PR, rebuild the task branch from the exact base and carry only the intended change. Never silently drop unrelated work.
4. **Validate the candidate.** Run focused tests/typecheck/build/repro appropriate to the changed code plus `git diff --check` when available. Confirm the base-to-head diff is non-empty and contains only intended work.
5. **Run the pre-open review gate.** Run `scripts/pre-open-gate.mjs` on the candidate base-to-head diff. For logic-bearing changes, complete every required bug lens and security surface with honest evidence and fix Confirmed High/Critical findings before publication. Never treat missing gate output as success.
6. **Build exact publication requests.** The user’s direct “create pr” instruction authorizes only the `push_code` and `create_pr` effects needed for this workflow. Build exact broker requests for the scoped branch and PR. Default to a draft PR unless the user explicitly asks for ready-for-review publication.
7. **Plan, authorize, execute.** Send every network-visible GitHub write through `scripts/github-mutate.mjs`. Obtain trusted authority where the action registry requires it, then execute the exact planned `push_code` and `create_pr` effects.
8. **Verify publication.** Re-read the created PR and confirm repository, base, head, title/body, draft state, and final branch head match the intended publication.

## Hard boundaries

- Do not load `references/shared-rules.md` as mandatory context. Load the policy kernel and modules declared above.
- Do not mutate the installed `github-delivery` skill while debugging a target repository. Use read-only inspection or temporary probes outside the installed runtime.
- If trusted authority is unavailable, fail closed and report the exact missing authority capability/setup.
- **Never offer or perform a bypass** with bare `git push`, `gh pr create`, a mutating connector call, or another write path outside the `github-delivery` mutation boundary.
- Do not add issue linkage or issue-side effects merely because another create-PR workflow supports them.

## Done when

- exactly one PR exists for the intended local work;
- the PR contains no unrelated files or commits;
- the candidate diff passed the applicable pre-open review gate;
- the remote branch and PR were created through the authorized mutation boundary;
- the resulting PR repository/base/head/draft state were verified; and
- no issue research, linkage, assignment, or issue comment was invented.
