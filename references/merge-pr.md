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
9. Confirm valid adaptive-settle evidence exists for the unchanged PR and immediate-base heads. If it does not, run the adaptive settle from `references/shared-rules.md`: announce that green is provisional, choose 60 or 180 seconds from the observed activity, poll `ship-gate.mjs` every 20 seconds without a silent sleep longer than 30 seconds, reset on changes, and require the final gate to return `ready`.
10. Immediately before the first mutation, rerun the authoritative gate and verify both recorded heads are unchanged.
11. Resolve linked issues through both GitHub closing references and body keywords.
12. Select the repository’s normal merge method. Do not silently squash when trailers or history matter.

## Internal mutation sequence

Create a temporary audit file for this PR, for example `shipping-github-pr-32-mutations.jsonl`. Every request is first planned without `--execute`, inspected, and then executed.

### 1. Pre-merge PR comment

Prepare an idempotent `post_comment` request containing:


- `mutationMode: "maintainer"`
- the exact repository, PR number, and current `expectedHead`
- a stable `idempotencyKey`, such as `merge-thanks-pr-32`
- a concrete 2–3 sentence why-it-helps comment
- thanks to the PR author only when they are not the authenticated user
- use the **Merge thanks** shape from `references/comment-depth.md`; keep GitHub `@mentions` bare and never backticked

Run it through:

```bash
node scripts/github-mutate.mjs --request request.json
node scripts/github-mutate.mjs --request request.json --execute --audit mutations.jsonl
```

### 2. Merge

Prepare a `merge_pr` request:

```json
{
  "schemaVersion": 1,
  "action": "merge_pr",
  "mutationMode": "maintainer",
  "explicitInstruction": true,
  "repo": "OWNER/REPO",
  "pr": 32,
  "expectedHead": "reviewed-head-sha",
  "mergeMethod": "merge"
}
```

The broker must re-read the head before mutation and pin the merge using `--match-head-commit`. A moved head is a hard stop requiring a fresh gate run.

### 3. Linked issue comments and closure

For every linked or fixed issue:

1. Read the issue author and current state.
2. Post one idempotent issue thank/fixed comment through the broker-supported social mutation path using the issue shape from `references/comment-depth.md`; keep the real `@login` bare and omit self-thanks.
3. If the fix is complete and the issue remains open, execute `close_linked_issue` through the broker with explicit instruction.
4. Leave epics or partially fixed issues open and state why.

Auto-close does not replace the required issue comment.

### 4. Cleanup

- Confirm the PR is actually merged, not merely queued.
- Confirm every required issue comment exists and complete issues are closed.
- Delete the same-repository head branch only when safe and not shared.
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
- the final response reports PR, issue, branch, and mutation receipt states.
