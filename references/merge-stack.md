# Merge discipline for stacks

Deprecated compatibility reference.

Use `references/stacked-prs.md` for all stacked-PR merge, retarget, restack, and recovery operations.

The canonical workflow merges bottom-up, re-inspects topology after every parent lands, retargets only through broker action `retarget_pr`, rewrites branches only through broker action `push_code`, and revalidates every surviving child on its new head/base generation.

Do not use raw mutating `gh api` or `git push` commands from a stack workflow.
