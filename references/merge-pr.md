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

Merge PR `#N` after readiness checks, comment why it is useful, thank the PR author when appropriate, then thank and close linked issues. Every visible GitHub write must pass through `scripts/github-mutate.mjs`; bare `gh pr merge`, direct issue comments, and direct issue closure are forbidden.

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

4. Require decision `ready` on the current head SHA. A blocked or unknown result forbids merge.
5. Require the PR not to be draft, WIP, held, conflicted, behind, or mid-stack.
6. Confirm required CI, review policy, unresolved threads, feedback, base health, and merge queue state are clear.
7. Confirm own bug, security, and spec/standards evidence exists this session, or obtain an explicit merge-anyway instruction after explaining the missing evidence.
8. Confirm the branch was built and tested against the current base tip.
9. Confirm valid adaptive-settle evidence exists for the unchanged PR and immediate-base heads. If it does not, run the adaptive settle from `references/shared-rules.md`: announce that green is provisional, choose 60 or 180 seconds from the observed activity (**~30–60s for a docs/markdown-only head**), poll `ship-gate.mjs` every 20 seconds without a silent sleep longer than 30 seconds, reset on changes, and require the final gate to return `ready`.
10. Immediately before the first mutation, rerun the authoritative gate and verify both recorded heads are unchanged.
11. Resolve linked issues through both GitHub closing references and body keywords.
12. Select the repository’s normal merge method. Do not silently squash when trailers or history matter.

## Internal mutation sequence

Run the **merge driver** — it chains the gate, settle, broker requests, and cleanup decision into one call so the agent reviews one plan and confirms execution instead of hand-rolling each write:

```bash
node "<github-delivery>/scripts/merge-pr-driver.mjs" OWNER/REPO N --mode maintainer --settle
```

The dry-run (no `--execute`) prints the ship-gate decision, the exact `post_comment` and `merge_pr` commands (with `--match-head-commit` head pinning), and the merge method. The agent **writes only the thanks-comment prose** (via `--thank-comment` or by editing the default) — every other step is scripted. Only when the plan is correct and the user's merge request is explicit, run:

```bash
node "<github-delivery>/scripts/merge-pr-driver.mjs" OWNER/REPO N --mode maintainer --settle --thank-comment "<why-it-helps prose>" --execute --audit github-delivery-pr-N-mutations.jsonl
```

`--execute` performs the writes through the broker only after the gate is `ready` on the pinned head, and appends every receipt to the audit file. A blocked gate, moved head, draft, or already-merged PR is a hard stop with a structured reason — never bypass.

The driver covers:

- **Pre-merge PR comment** — idempotent `post_comment` (`idempotencyKey: merge-thanks-pr-N`) with the thanks/why-it-helps body; thanks the author only when they are not the authenticated user; use the **Merge thanks** shape from `references/comment-depth.md`; keep GitHub `@mentions` bare and never backticked.
- **Merge** — `merge_pr` with `--match-head-commit` head pinning (a moved head is a hard stop requiring a fresh gate run); the driver re-reads the head before mutation and verifies the merge receipt.
- **Linked issue comments and closure** — still a judgment step the agent performs after the driver (see below).

### 3. Linked issue comments and closure

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

### 4. Cleanup

- Confirm the PR is actually merged, not merely queued (the driver verifies the merge receipt; also confirm every required issue comment exists and complete issues are closed).
- The driver reports the owner-scoped branch-cleanup decision via `evaluateHeadBranchCleanup`. When the decision is `delete`, run broker action `delete_head_branch` through `scripts/github-mutate.mjs` (or let the driver's cleanup plan drive it in a later iteration).
- Report one explicit status line (`branch deleted: …`, `branch kept: head owned by @other`, `branch kept: protected shared branch`, or `branch kept: user requested keep`).
- Delete only when the head owner matches the authenticated actor. This applies to **same-repo and fork PRs**; fork heads delete from the head fork repo.
- Retarget stack children before deleting a stack parent branch.
- Hand off versioning or worktree cleanup to the appropriate skill.

## Failure handling

- Broker denial: report its structured reason; perform no bypass write.
- Expected-head mismatch: rerun the full gate and adaptive settle on the new head and immediate-base head.
- Partial ceremony: continue only the missing idempotent step; do not duplicate completed comments.
- Mutation command failure: include the action, receipt or plan hash, and error; never claim success.
- Verification mismatch: treat the mutation as unresolved until repository state confirms it.

## Done when

- the authoritative gate was ready on the merged head;
- the pre-merge why/comment was posted through the broker;
- the broker receipt verifies the PR merged;
- every linked issue received its required comment;
- complete linked issues are closed;
- cleanup is done or explicitly deferred;
- the final response reports PR, issue, branch cleanup status, and mutation receipt states.
