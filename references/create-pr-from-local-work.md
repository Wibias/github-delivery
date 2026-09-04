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

After that successful workflow selection, supported Codex hook execution rejects direct `git push` and `gh pr create` with `create_pr_direct_write_forbidden`. This is an early execution guard, not the publication proof: the controller still requires the canonical planner lock and successful broker receipts.

Do not re-decide the route, direct-write policy, initial PR state, or mutation entrypoint from repository prose, historical PRs, tool availability, or later model preference. Do not reread or grep github-delivery implementation source during the happy path. Source inspection is diagnostic-only after a named helper or executable contract actually fails.

If the active higher-priority instruction stack genuinely requires a GitHub write path this workflow forbids, **fail closed once** and surface that instruction conflict. Do not debate precedence repeatedly, alternate between `gh` and github-delivery, or try one write path and then fall back to another.

## Workflow

1. **Resolve local context.** Identify the repository, current branch, default/development base, working-tree state, and commits that differ from the intended base.
2. **Lock scope before staging.** Separate the work the user asked to publish from unrelated pre-existing files or commits. Preserve unrelated work. Do not use `git add -A` as a default shortcut when the working tree contains mixed scope.
3. **Prepare a clean task branch.** Apply `references/git-workflow.md` for repository-convention branch/commit organization. If work is on the default branch, create a task branch. If unrelated local commits would leak into the PR, rebuild the task branch from the exact base and carry only the intended change. Never silently drop unrelated work.
4. **Validate the candidate.** Run focused tests/typecheck/build/repro appropriate to the changed code plus `git diff --check` when available. Confirm the base-to-head diff is non-empty and contains only intended work. Before publication, use the Git-workflow change summary to identify the logical change, intentionally untouched related surfaces, material concerns, and checks actually run.
5. **Produce hygiene evidence through the orchestrator.** Resolve no-comments and simplify independently; do not mint checkpoint receipts directly and do not rediscover helper JSON shapes from source.
   - When no-comments runs, execute `node scripts/create-pr-hygiene.mjs prepare --root <repo-root> --base <base-ref-or-sha> --head <head-sha> --scope <scope.json> --snapshot <outside-repo-snapshot>`. Give Comment Inspector exactly the generated `scope.json`. It may read nearby context but may classify only that immutable diff-added-line scope. Save only its final structured `github-delivery/comment-review-result` as `<comment-result.json>`.
   - Run `references/simplify-pr.md` unless opted out and record one `<simplify.json>` pass object: successful review uses `{ "outcome": "clean", "method": "simplify-pass", "validationPassed": true }`; an explicit opt-out uses `{ "outcome": "skipped", "method": "opt-out", "reason": "<the user opt-out>" }`.
   - Finalize with `node scripts/create-pr-hygiene.mjs finalize --root <repo-root> --head <head-sha> --scope <scope.json> --snapshot <outside-repo-snapshot> --result <comment-result.json> --simplify <simplify.json> --output <hygiene.json>`. The helper verifies unchanged reviewer bytes, discards the verified snapshot, validates the final result against the exact scope, and refuses to turn DELETE/root-cause findings into a clean receipt. If it reports `comment_review_guard_changed_restore_required`, restore through `comment-review-guard.mjs` before doing anything else. If it reports pending no-comments changes, the parent applies accepted in-scope fixes, revalidates/commits the new head, then restarts hygiene on that new head.
   - When no-comments is explicitly opted out, do not prepare/spawn it. Run `node scripts/create-pr-hygiene.mjs skip-no-comments --head <head-sha> --reason "<the user opt-out>" --simplify <simplify.json> --output <hygiene.json>`.
6. **Run compact pre-open and assemble review evidence without per-row boilerplate.** Run `node scripts/pre-open-gate.mjs OWNER/REPO <base> <head> --compact --checkpoint <workflow-checkpoint> --output <preopen-summary.json>`. The top-level `decision` plus exit code is authoritative. If it is already `ready`, continue. When blocked only on review evidence, use `remaining` and `evidenceRequirements` as the exact worklist.
   - Perform one structured **bug-axis** review that explicitly covers every ID in `remaining.lenses` and every file required by `evidenceRequirements.lenses`; perform one structured **security-axis** review with the same rule for `remaining.surfaces` / `evidenceRequirements.surfaces`. Preserve every deterministic probe as its own canonical structured probe-evidence record.
   - Write one `<review-result.json>` with `schemaVersion: 1`, `kind: "github-delivery/pre-open-review-result"`, the exact `headSha`, and `bug` / `security` objects containing `status: "clean"`, a bounded `method`, `coveredIds`, and the union of actually `reviewedFiles`; put the canonical required probe records under `probes`.
   - Run `node scripts/pre-open-review-evidence.mjs --summary <preopen-summary.json> --review <review-result.json> --output <preopen-evidence.json>`. This helper does **not** reduce coverage: it emits every existing schema-v2 lens/surface row only when its semantic ID and required files were covered by the corresponding axis review.
   - Rerun `node scripts/pre-open-gate.mjs OWNER/REPO <base> <head> --compact --checkpoint <workflow-checkpoint> --evidence-file <preopen-evidence.json> --hygiene-file <hygiene.json>`. Continue only on top-level `decision=ready` and exit `0`. Full gate output is diagnostic-only when compact output or evidence validation itself fails.
7. **Check exact-head publication identity.** Before planning `create_pr`, prove whether an open PR already exists for the exact target repository + head identity + intended base. This is an identity check, not fuzzy title/body similarity. The `create_pr` lifecycle preflight independently repeats this live check immediately before execution.
   - exactly one match → **reuse/report that PR**; do not create another;
   - multiple matches → fail closed and report every matching PR;
   - no match → continue.
   A PR on the same head branch but a different intended base is not a P0 duplicate; multi-base/port policy may govern it separately.
8. **Build one canonical publication plan.** Write only the planner inputs (repo, remote, branch, base, exact local/remote tips, title/body, idempotency key, checkpoint) to a temporary JSON file. Run `node scripts/create-pr-publication-plan.mjs --input <input> --output <plan>`. The planner locks the exact `push_code` + initial draft `create_pr` operation identities into the checkpoint. Plain “open/create a PR” never means ready-for-review. If the user explicitly requested ready-for-review, initial creation still stays draft and any later `change_draft_state` is a separate explicit operation after creation and verification.
9. **Execute the generated plan unchanged.** Pass the generated plan unchanged to `scripts/github-mutate.mjs --request <plan> --execute --checkpoint <workflow-checkpoint> [--audit <file>]`. Do not hand-build equivalent publication requests and do not fall back to `git push`, `gh pr create`, or a mutating connector. The workflow cannot leave `OPEN_PR` until matching successful broker receipts exist for both locked operations. If the `create_pr` preflight returns `create_pr_existing`, stop publication and reuse the named PR.
10. **Verify publication.** Re-read the created or reused PR and confirm repository, base, head, title/body, draft state, and final branch head match the intended publication. Do not rewrite an existing PR body merely because it was reused unless the user’s requested workflow separately authorizes that update. Fail closed if the live body contains literal `\\n` / `\\t` escape sequences or collapsed markdown headings instead of real newlines; repair through `update_pr_body` rather than treating escaped markdown as successful publication.

## Hard boundaries

- Do not load `references/shared-rules.md` as mandatory context. Load the policy kernel and modules declared above.
- Do not mutate the installed `github-delivery` skill while debugging a target repository. Use read-only inspection or temporary probes outside the installed runtime.
- If trusted authority is required by the selected protection mode and unavailable, fail closed and report the exact missing authority capability/setup. Protection mode `off` does not require the Authority host or repository allowlist.
- **Never offer or perform a bypass** with bare `git push`, `gh pr create`, a mutating connector call, or another write path outside the `github-delivery` mutation boundary.
- Never treat a direct-write instruction conflict as permission to experiment with multiple write paths. Fail closed once and report the conflict.
- Do not add issue linkage or issue-side effects merely because another create-PR workflow supports them.
- Do not defeat exact-head duplicate prevention by changing the title/body, inventing another local branch name for the same remote head, or weakening repository identity.
- Do not reduce a large compact evidence worklist by omitting required IDs. Aggregation removes repetitive record construction, not required review coverage.

## Done when

- exactly one PR exists for the intended local head/base publication;
- an already-existing exact-head/base PR was reused rather than duplicated when present;
- the PR contains no unrelated files or commits;
- current-head hygiene evidence came from the deterministic orchestration boundary;
- the candidate diff passed the compact pre-open gate with top-level `decision=ready` using complete semantic-ID/file coverage and required probes;
- any remote branch/PR publication was performed from the canonical generated plan through the authorized mutation boundary;
- the resulting PR repository/base/head/draft state were verified; and
- no issue research, linkage, assignment, or issue comment was invented.
