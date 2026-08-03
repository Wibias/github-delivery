# Restack scenarios

Use only when a parent tip moved, a parent PR merged, or trunk advanced under an open stack.

## A — Parent gained commits (review feedback)

```bash
git fetch origin
git checkout "$CHILD_BRANCH"
git rebase "origin/$PARENT_BRANCH"
git push --force-with-lease
```

For depth ≥ 2, walk bottom → top so each child rebases onto the updated parent.

## B — Parent merged into trunk

1. Check auto-retarget: `gh pr view "$CHILD_N" --json baseRefName --jq .baseRefName`
2. If still pointing at the deleted parent branch, PATCH base to trunk via REST.
3. Rebase child onto `origin/$TRUNK` and `push --force-with-lease`.

Squash-merge replaces parent commits with one trunk commit — expect possible
hunk conflicts; keep the trunk (squashed) form as canonical.

## C — Trunk moved while the stack is open

Rebase the bottom PR onto `origin/$TRUNK` first, push with lease, then walk up
the chain rebasing each child onto its parent.

## Conflict rule

Resolve only hunks that belong to the current PR's concern. If the only fix
pulls in a sibling PR's code, stop and tell the user the stack shape is wrong.
