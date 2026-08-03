# Merge discipline for stacks

## Order

Merge **bottom-up, one at a time**. A top PR whose base is still a parent branch
must not land first — that merges into the parent branch, not trunk.

```text
1. Merge bottom PR (base = trunk)
2. Verify child bases retarget to trunk (or PATCH)
3. Restack next child onto trunk
4. Merge next; repeat
```

## Retarget before delete risk

If the repo auto-deletes head branches on merge, retarget immediate children
**before** merging the parent so GitHub does not close them:

```bash
gh api "repos/$OWNER/$REPO/pulls/$CHILD_N" -X PATCH -f base="$TRUNK"
```

## Empty after restack

If a child diff collapses to empty after a parent lands, close that PR with a
one-line explanation. Do not leave empty PRs open.

## Review hygiene

- Avoid rebasing the bottom PR mid-review round (breaks comment anchors).
- Do not request full review on PR K while PR K-1 is still unapproved, unless
  the reviewer is explicitly scoped to the delta only.
