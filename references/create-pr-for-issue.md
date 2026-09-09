<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- reviews
- issues
- publication
- runtime-verification (when a project-local verify-* skill exists and the candidate changes observable runtime behavior or has material runtime risk)
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Create PR for issue -> merge-ready

**Trigger:** Create a PR for issue `#N`, make it merge-ready, do not merge.

## Goal

Open only requested PRs on the issue's canonical repository. Fix the verified issue, preserve unrelated work, pass required gates, link/assign/notify as permitted, and stop before merge.

For explicit **open the PR and stop** requests, run through E, then `OPEN_PR -> DONE` only after live identity verification and both locked publication receipts; skip F/G.

## Runtime contract

- Load policy modules.
- Keep the controller checkpoint. Writes: `node scripts/github-mutate.mjs --request <file> --execute --checkpoint <workflow-checkpoint>`.
- `create_pr` intent is controller-owned/operation-bound. Never repair via manual `--workflow-intent`, checkpoint edits, or `explicitInstruction`; changed payloads need fresh intent.
- `github-mutate.mjs` owns authority; `off` skips only Hello/Authority, protected modes retain it.
- Local work is not publication; broker remote writes.
- Issue publication uses `scripts/create-pr-publication-plan.mjs`; no hand-built mutation schemas or direct `git push` / `gh pr create`.
- **Do not merge.**

## A. Need-to-fix preflight

Before coding, capture the current issue/development snapshot:

1. Is the issue still needed on the latest development/base tip?
2. Was it already fixed there? If yes, identify the SHA/PR.
3. Is an open PR already covering it?
4. Is it an obvious duplicate?

### Full issue thread intake

Read the issue body, **every comment** with pagination, labels, linked PRs, and timeline scope changes. Extract the Agent Brief, clarifications, `[GD]` research, repro updates, acceptance criteria, screenshots, and non-goals. Carry that contract into implementation, PR description, and Spec review.

### Screenshot gate

Review author-provided screenshots/images before implementation. If required screenshots cannot be reviewed, stop.

### Preflight outcome

- **Already fixed/shipped:** no PR.
- **Covering PR exists:** reuse/report it; no duplicate.
- **Duplicate issue:** use the canonical issue; no duplicate PR.
- **Still needs fix:** continue.
- **Evidence incomplete:** restore it; do not guess.

Reuse a matching `research-issue.md` verdict when development tip and issue conversation are unchanged. Re-enter preflight only when a new fact invalidates that decision.

## B. Confirm scope

Default to one cohesive PR. Split only for independently shippable concerns with separate validation/review boundaries or conflicting acceptance criteria. Batches over three issues use fan-out.

## C. Implement locally

1. Start from the exact base/development tip from A. Use a task branch/worktree that preserves unrelated work. Apply `references/git-workflow.md`; repository rules and `GD-GIT-*` remain authoritative.
2. For non-trivial implementation, apply `references/minimal-solution.md`; make the smallest complete change without weakening safeguards.
3. Follow required consumers; for broad migrations or deterministic sweeps apply `references/change-execution.md`.
4. Run focused tests/typecheck/build/repro and repository-local checks as applicable.
5. Require a non-empty base-to-head diff containing only intended work. If no change is needed, return to the matching preflight outcome.
6. Hygiene: use canonical helpers for both passes. Caller text cannot opt out or supply trusted skip provenance. Until controller/host-owned user intent can prove a skip, run `references/no-comments.md` and `references/simplify-pr.md`; skipped results fail closed.

## D. Pre-open bug + security gate

After implementation and before push/open:

```text
node <github-delivery>/scripts/pre-open-gate.mjs OWNER/REPO <base> <head> --checkpoint <workflow-checkpoint>
```

- `ready`: continue.
- `blocked` with `workflow:implementation_missing`: return to C.
- other `blocked`: run every required bug/security pass. Load `bug-review.md` / `security-review.md` only for triggered lenses/surfaces, fix Confirmed High/Critical findings, and record one head-bound row per required lens/surface with status, bounded method, and required file coverage. Candidate-wide `bug: clean` / `security: clean` is non-authoritative.
- `unknown`: stop and restore complete branch evidence.

Carry completed gate/review evidence into PR validation notes.

## E. Publish the canonical PR

1. Resolve canonical repository identity from the **issue** and the correct base branch.
2. Build the PR description from `references/pr-description.md`, final diff, issue contract, and completed validation; never claim planned work as done.
3. Resolve exact tips/identity. Run `node scripts/create-pr-publication-plan.mjs --input <input> --output <plan>` to lock `push_code` plus draft `create_pr` to the checkpoint.
4. Execute that plan unchanged via `node scripts/github-mutate.mjs --request <plan> --execute --checkpoint <workflow-checkpoint>`. No direct `git push` / `gh pr create`; force-with-lease is planner-owned.
5. Re-check canonical repo + head + base. Reuse one exact open PR; multiple or none after successful publication fail closed. `create_pr_existing` names reuse.
6. Require canonical repo/base/head and successful receipts for both locked operations.
7. Explicit open-only request: `OPEN_PR -> DONE`; otherwise continue to F/G.

## F. Link, assign, notify

GitHub closing keywords depend on the PR base:

- **Default branch:** put `Fixes #N` or `Closes #N` on its own line and verify `closingIssuesReferences`.
- **Non-default branch:** GitHub ignores closing keywords for linking/auto-close. Keep `Refs #N`, do not loop on empty `closingIssuesReferences`; the issue comment below provides the durable pointer.

Then:

1. Assign yourself on the issue with broker action `assign_issue` when permitted. If denied, report once and continue.
2. Post exactly one idempotent brokered issue comment: `[GD] Opened PR #<pr> to address this.` Reuse the canonical PR number.
3. Spot-check issue/PR references point to the canonical PR.

## G. Make merge-ready

Work on the current PR head until the authoritative merge-ready bar passes:

1. Keep branch current with base; resolve conflicts safely. Remote updates use `push_code`.
2. Process current human/bot feedback; fix required findings or decline with verified rationale.
3. Require green CI on current SHA; helpers never override `ship-gate.mjs`.
4. Complete own bug, security, Spec + Standards, semantic propagation, proactive contract verification, CODEOWNERS, and applicable `runtime-verification`; load detail only for active axes.
5. Reconcile the PR description with final-head scope, validation, limitations, and linkage via broker action `update_pr_body`; preserve protected media absent explicit removal authority.
6. Run the settle window; re-read reviews/checks/rules/base/head; run the final ship gate. Head changes invalidate head-bound evidence.
7. Publish merge-ready PR and linked-issue notifications through brokered actions. **Do not merge.**

## H. Completion report

Apply `references/completion-claims.md` to current authoritative evidence. Re-measure material counts and preserve unknown, blocked, not-run, and partial states.

## Done when

For normal merge-ready delivery:
- Only requested PRs; canonical issue repository and intended base/head.
- Full issue thread and Screenshot gate complete; preflight is evidence-backed.
- Non-empty implementation diff existed before pre-open; every required bug/security row is head/file-bound, not aggregate clean evidence.
- Hygiene evidence came from canonical passes; caller text did not bypass them.
- Exact-head/base publication was reused instead of duplicated.
- Network writes used the canonical planner plus `github-mutate.mjs` with required authority.
- PR description matches final head/issue contract; linkage and protected-media rules are satisfied.
- Self-assignment when possible; one opened-PR issue comment; no duplicates.
- Reviews, feedback, required CI, freshness, applicable runtime verification, and final ship gate pass on final head.
- Final report satisfies `references/completion-claims.md`.
- Merge-ready was published and **the PR was not merged**.

Open-only delivery ends at E only after both locked receipts and live PR identity verification; no F/G.
