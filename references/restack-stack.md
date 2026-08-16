# Restack scenarios

Deprecated compatibility reference.

Use `references/stacked-prs.md` for all stack inspection, restack, retarget, recovery, and merge operations.

Do not execute raw `git push`, `git push --force-with-lease`, or mutating `gh api` commands from this file. The canonical stack workflow binds remote identity, expected branch generations, backup refs, rewrite scope, and every network-visible mutation through `scripts/github-mutate.mjs`.
