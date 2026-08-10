<!-- policy-modules:start -->
Policy modules:
- policy-kernel
- mutation
- evidence
- git
- ci
- publication
- releases
- issues
- stacks (when stack topology is detected)
<!-- policy-modules:end -->

# Merge PR

**Trigger:** “merge pr #N”, “merge pr #A and #B”, “merge it”, “ship pr #N”.

## Public interface

The user speaks naturally. `merge PR #32` must load this workflow through `SKILL.md`; the agent then runs the required scripts internally. Never require the user to construct a broker request or invoke Node manually.

## Goal

Merge PR `#N` only after readiness checks pass on the current head. After GitHub confirms the merge, post the useful/thanks comment when appropriate, then thank and close complete linked issues. Every visible GitHub write must pass through `scripts/github-mutate.mjs`; bare `gh pr merge`, direct issue comments, and direct issue closure are forbidden.

A success-looking social write must never precede the state transition it describes. The merge happens first; the merge thank-you happens only after the merge succeeds.

## Mutation mode

A direct request such as `merge PR #32` authorizes `maintainer` mode with explicit instruction for the `merge_pr` action and the linked close-out actions required by this workflow. It does not authorize unrelated writes. Human replies still require exact-text confirmation.

Read `references/mutation-modes.md` and `references/github-mutation-broker.md` before the first write.

## Targets

- Default: one PR.
- Several PRs: run this entire workflow for each PR.
- More than three PRs: fan out one target per subagent, but keep one mutation audit per PR.
- A stacked PR must hand off to `manage-stacked-prs` and merge bottom-up.

## Preflight

1. Load PR metadata, author, body, labels, linked issues, base/head refs, stack state, and fork permissions.
2. Run runtime capability discovery. Stop if required read or write capabilities are unavailable.
3. Run the authoritative gate using the active mutation mode:

   ```bash
   node scripts/ship-gate.mjs OWNER/REPO N --mutation-mode maintainer
   ```

4. If and only if the gate is blocked solely by pending required CI, run the canonical adaptive CI wait instead of hand-rolling a bounded shell loop:

   ```bash
   node "<github-delivery>/scripts/ci-wait.mjs" OWNER/REPO N --workflow merge-pr --mutation-mode maintainer
   ```

   The driver starts unknown timing at the 5-minute estimate, polls every 30 seconds, learns per-repository/check duration from successful runs, and has no fixed default wait cap. Five minutes is not a timeout. Runner/platform names may be repeated only from current GitHub check evidence. A moved head, unknown evidence, or any non-CI blocker stops the wait and returns control to preflight.
5. Require decision `ready` on the current head SHA after any CI wait. A blocked or unknown result forbids merge.
6. Require the PR not to be draft, WIP, held, conflicted, behind, or mid-stack.
7. Confirm required CI, review policy, unresolved threads, feedback, base health, and merge queue state are clear.
8. Require current-head Bug, Security, and Spec/Standards review evidence with valid review-verdict provenance. Missing review evidence is not waivable inside the merge workflow: run or complete the required review workflow on the current head before continuing.
9. Confirm the branch was built and tested against the current base tip.
10. Confirm valid adaptive-settle evidence exists for the unchanged PR and immediate-base heads. If it does not, run the adaptive settle from `references/shared-rules.md`: announce that green is provisional, choose 60 or 180 seconds from observed activity (**~30–60s for a docs/markdown-only head**), poll `ship-gate.mjs` every 20 seconds without a silent sleep longer than 30 seconds, reset on changes, and require the final gate to return `ready`.
11. Immediately before the first mutation, rerun the authoritative gate and verify the recorded head/base generation is unchanged.
12. Resolve linked issues through both GitHub closing references and body keywords.
13. Select the repository’s normal merge method. Do not silently squash when trailers or history matter.

## Internal mutation sequence

Run the **merge driver**. It chains the gate, settle, broker requests, and cleanup decision into one call so the agent reviews one plan instead of hand-rolling writes:

```bash
node "<github-delivery>/scripts/merge-pr-driver.mjs" OWNER/REPO N --mode maintainer --settle
```

The dry-run (no `--execute`) prints the ship-gate decision, the exact merge and post-merge comment plans, the pinned head, and merge method. The agent may provide the post-merge thank-you prose via `--thank-comment`. Only when the plan is correct and the user's merge request is explicit, run:

```bash
node "<github-delivery>/scripts/merge-pr-driver.mjs" OWNER/REPO N --mode maintainer --settle --thank-comment "<why-it-helps prose>" --execute --audit github-delivery-pr-N-mutations.jsonl
```

`--execute` performs writes through the authority-aware broker only after the gate is `ready` on the pinned head. A blocked gate, moved head, draft, already-merged PR, or authority failure is a hard stop.

### Driver transaction order

The order is mandatory:

1. **Merge** — execute `merge_pr` with `--match-head-commit` head pinning.
2. **Verify merge success** — the merge receipt/read-back must confirm that GitHub accepted the merge.
3. **Post-merge PR thank-you** — only after step 2 succeeds, execute the idempotent `post_comment` (`idempotencyKey: merge-thanks-pr-N`). Use the **Merge thanks** shape from `references/comment-depth.md`; thank the author only when appropriate; keep GitHub `@mentions` bare and never backticked.
4. **Linked issue comments and closure** — perform the judgment-dependent issue close-out below.

If the merge fails or returns an unresolved outcome, do **not** post a success-looking “merged” comment. Reconcile remote state first.

The post-merge comment is independently idempotent. A retry after a lost comment response must reuse the existing marker-backed comment instead of creating a duplicate.

### Linked issue comments and closure

For every linked or fixed issue:

1. Read the issue author and current state.
2. Post one idempotent issue thank/fixed comment through the broker-supported social mutation path using the issue shape from `references/comment-depth.md`; keep the real `@login` bare and omit self-thanks.
3. If the fix is complete and the issue remains open, execute `close_linked_issue` through the broker with explicit instruction.
4. Leave epics or partially fixed issues open and state why.

Auto-close does not replace the required issue comment.

<!-- assertion-anchors -->
<!-- assertion: issue-thank-required -->
<!-- assertion: auto-close-not-enough -->
<!-- assertion: multi-pr-full-ceremony -->
<!-- /assertion-anchors -->

### Cleanup

- Confirm the PR is actually merged, not merely queued, before any success claim or post-merge thanks.
- Confirm every required issue comment exists and complete issues are closed.
- The driver reports the owner-scoped branch-cleanup decision via `evaluateHeadBranchCleanup`. When the decision is `delete`, run broker action `delete_head_branch` through `scripts/github-mutate.mjs`.
- Report one explicit status line (`branch deleted: …`, `branch kept: head owned by @other`, `branch kept: protected shared branch`, or `branch kept: user requested keep`).
- Delete only when the head owner matches the authenticated actor. This applies to same-repo and fork PRs; fork heads delete from the head fork repo.
- Retarget stack children before deleting a stack parent branch.
- Hand off versioning or worktree cleanup to the appropriate skill.

## Failure handling

- Broker/authority denial: report its structured reason; perform no bypass write.
- Expected-head or snapshot-generation mismatch: rerun the full gate and adaptive settle on the new generation.
- Merge failure: do not post the merge-success comment.
- Lost/unknown merge response: read the PR state before retrying; if GitHub already reports merged, continue with the missing post-merge steps only.
- Lost/unknown comment response: rely on the marker-backed idempotency lookup before posting again.
- Partial ceremony: continue only the missing idempotent step; do not duplicate completed comments.
- Mutation command failure: include the action, receipt or plan hash, and error; never claim success.
- Verification mismatch: treat the mutation as unresolved until repository state confirms it.

## Done when

- the authoritative gate was ready on the head that GitHub merged;
- the broker receipt/read-back verifies the PR merged;
- only after merge success, the post-merge why/thanks comment exists through the broker;
- every linked issue received its required comment;
- complete linked issues are closed;
- cleanup is done or explicitly deferred;
- the final response reports PR, issue, branch cleanup status, and mutation receipt states.
