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

## Execution lock

Immediately after routing, run `node scripts/workflow-brief.mjs create-pr-from-local-work` and **run it once** for the routed head. Treat its execution contract plus the persistent workflow-controller checkpoint as the normal-operation authority for helper paths, declared GitHub actions, source-discovery policy, pre-open output mode, initial PR state, and publication boundary.

Do not re-decide the route, direct-write policy, initial PR state, or mutation entrypoint from repository prose, historical PRs, tool availability, or later model preference. Do not reread or grep github-delivery implementation source during the happy path. Source inspection is diagnostic-only after a named helper or executable contract actually fails.

If the active higher-priority instruction stack genuinely requires a GitHub write path this workflow forbids, **fail closed once** and surface that instruction conflict. Do not debate precedence repeatedly, alternate between `gh` and github-delivery, or try one write path and then fall back to another.

## Workflow

1. **Resolve local context.** Identify the repository, current branch, default/development base, working-tree state, and commits that differ from the intended base.
2. **Lock scope before staging.** Separate the work the user asked to publish from unrelated pre-existing files or commits. Preserve unrelated work. Do not use `git add -A` as a default shortcut when the working tree contains mixed scope.
3. **Prepare a clean task branch.** Apply `references/git-workflow.md` for repository-convention branch/commit organization. If work is on the default branch, create a task branch. If unrelated local commits would leak into the PR, rebuild the task branch from the exact base and carry only the intended change. Never silently drop unrelated work.
4. **Validate the candidate.** Run focused tests/typecheck/build/repro appropriate to the changed code plus `git diff --check` when available. Confirm the base-to-head diff is non-empty and contains only intended work. Before publication, use the Git-workflow change summary to identify the logical change, intentionally untouched related surfaces, material concerns, and checks actually run.
4a. **Hygiene passes.** Resolve the passes independently. Run `references/no-comments.md` unless no-comments is specifically opted out (`skip no-comments`, `without no-comments`, `keep source comments`, `don't strip comments`). Then run `references/simplify-pr.md` unless simplify is specifically opted out (`without simplify`, `skip simplify`, `don't simplify`). A no-comments opt-out skips only no-comments; a simplify opt-out skips only simplify. A failed no-comments pass blocks publication. Comment Inspector is report-only; the parent owns every accepted comment deletion or root-cause mutation. If either parent-applied hygiene pass changed the tree, re-validate with both passes disabled.
5. **Run the compact pre-open review gate.** Normal execution uses `scripts/pre-open-gate.mjs OWNER/REPO <base> <head> --compact --checkpoint <workflow-checkpoint>` on the candidate diff. The **top-level `decision`** plus process exit code is authoritative. Do not inspect nested full-scope internals to reinterpret a ready result. When blocked, use the compact `remaining` and `evidenceRequirements` fields as the exact worklist; they intentionally provide required IDs and scoped file suggestions without manufacturing `done` evidence. Complete every required bug lens/security surface/probe honestly, fix Confirmed High/Critical findings, then rerun compact mode with `--evidence-file`. Full gate output is diagnostic-only when compact output or evidence validation itself fails.
6. **Check exact-head publication identity.** Before planning `create_pr`, prove whether an open PR already exists for the exact target repository + head identity + intended base. This is an identity check, not fuzzy title/body similarity. The `create_pr` lifecycle preflight independently repeats this live check immediately before execution.
   - exactly one match → **reuse/report that PR**; do not create another;
   - multiple matches → fail closed and report every matching PR;
   - no match → continue.
   A PR on the same head branch but a different intended base is not a P0 duplicate; multi-base/port policy may govern it separately.
7. **Build one canonical publication plan.** Write only the planner inputs (repo, remote, branch, base, exact local/remote tips, title/body, idempotency key, checkpoint) to a temporary JSON file. Run `node scripts/create-pr-publication-plan.mjs --input <input> --output <plan>`. The initial `create_pr` is always draft; plain “open/create a PR” never means ready-for-review. If the user explicitly requested ready-for-review, initial creation still stays draft and any later `change_draft_state` is a separate explicit operation after creation and verification.
8. **Execute the generated plan unchanged.** Pass the generated plan unchanged to `scripts/github-mutate.mjs --request <plan> --execute --checkpoint <workflow-checkpoint> [--audit <file>]`. The plan already contains the canonical `push_code` + draft `create_pr` request shapes and the mutation entrypoint. Do not hand-build equivalent publication requests during normal execution. For routed `create_pr`, the controller binds the first exact publication operation to the current workflow intent automatically. Do not repair missing intent by adding caller `explicitInstruction`, editing checkpoint JSON, or calling `delivery-controller.mjs authorize-mutation --workflow-intent`. Protection mode `off` skips only the additional Windows Hello / trusted-authority layer; protected modes retain it. If the `create_pr` preflight returns `create_pr_existing`, stop publication and reuse the named PR instead of bypassing the check.
9. **Verify publication.** Re-read the created or reused PR and confirm repository, base, head, title/body, draft state, and final branch head match the intended publication. Do not rewrite an existing PR body merely because it was reused unless the user’s requested workflow separately authorizes that update.
   Fail closed if the live body contains literal `\\n` / `\\t` escape sequences or collapsed markdown headings instead of real newlines. Repair through `update_pr_body` rather than treating escaped markdown as a successful publication.

## Hard boundaries

- Do not load `references/shared-rules.md` as mandatory context. Load the policy kernel and modules declared above.
- Do not mutate the installed `github-delivery` skill while debugging a target repository. Use read-only inspection or temporary probes outside the installed runtime.
- If trusted authority is required by the selected protection mode and unavailable, fail closed and report the exact missing authority capability/setup. Protection mode `off` does not require the Authority host or repository allowlist.
- **Never offer or perform a bypass** with bare `git push`, `gh pr create`, a mutating connector call, or another write path outside the `github-delivery` mutation boundary.
- Never treat a direct-write instruction conflict as permission to experiment with multiple write paths. Fail closed once and report the conflict.
- Do not add issue linkage or issue-side effects merely because another create-PR workflow supports them.
- Do not defeat exact-head duplicate prevention by changing the title/body, inventing another local branch name for the same remote head, or weakening repository identity.

## Done when

- exactly one PR exists for the intended local head/base publication;
- an already-existing exact-head/base PR was reused rather than duplicated when present;
- the PR contains no unrelated files or commits;
- the candidate diff passed the applicable compact pre-open review gate with top-level `decision=ready`;
- any required remote branch/PR publication was performed from the canonical generated plan through the authorized mutation boundary;
- the resulting PR repository/base/head/draft state were verified; and
- no issue research, linkage, assignment, or issue comment was invented.
