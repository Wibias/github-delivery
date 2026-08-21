# Stacked PR Policy

Canonical rules for discovering, updating, rewriting, recovering, and merging PR stacks.

### GD-STACK-001 — Discover topology before stack mutation

A PR whose base is another open PR head, or which has open children, is part of a stack. GitHub native `stack` membership is also a stack. Discover parent/child/base/head relationships, and native stack identity, before mutation, readiness, supersede, retarget, or merge decisions. When inferred bases and native membership disagree, native membership wins.

### GD-STACK-002 — Merge bottom-up and revalidate survivors

Never merge a middle/top PR as if it targeted trunk. Never merge a GitHub-native stack member as an independent trunk PR. Merge the bottom eligible inferred PR first, then re-read and revalidate every surviving child because its base/topology and required evidence may have changed. Native stacks cannot use `gh pr merge`; github-delivery hard-stops until a native stack merge API exists.

### GD-STACK-003 — Update against the immediate parent

For stack synchronization, update the bottom PR from trunk and each child from its immediate parent, bottom to top. Do not flatten ancestry merely for convenience.

### GD-STACK-004 — Bound force-with-lease rewrites

A stack restack/recovery may use `--force-with-lease` only when explicitly authorized, on writable non-default branches, after recording expected remote tips, creating backup refs, and presenting the bounded rewrite plan. A lease mismatch stops the operation.

### GD-STACK-005 — Preserve trunk-vs-parent intent

Do not treat a child PR's immediate parent as interchangeable with trunk. Review, diff, conflict resolution, readiness, and merge decisions use the actual parent relationship until retargeted.

### GD-STACK-006 — Retarget children before removing a parent

Do not close/supersede/delete a stack parent while open children depend on it unless the children have first been intentionally retargeted/restacked and verified.

### GD-STACK-007 — Recovery is evidence-bound

Recover rewritten stack branches only from verified expected remote tips/backups. Re-read GitHub heads after each rewrite; never infer recovery success from local history alone.
