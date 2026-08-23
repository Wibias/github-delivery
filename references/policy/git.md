# Git Safety Policy

Canonical rules for local/remote branch mutation, ownership, and current-tip verification.

### GD-GIT-001 — Stop on unrelated dirty work

Before editing, stop on unrelated uncommitted changes. Never stash, discard, reset, or absorb unrelated user work silently.

### GD-GIT-002 — Never use bare force

Never use `git push --force`. `--force-with-lease` is permitted only for an explicitly authorized stack restack/recovery on a writable non-default branch after recording the expected remote tip, creating a backup ref, and presenting the bounded rewrite plan.

### GD-GIT-003 — Push rejection is a stop signal

If a normal push or lease is rejected, stop and re-establish remote state/authority. Do not escalate to force to make the operation succeed.

### GD-GIT-004 — Respect the PR ownership boundary

A PR branch is ours only when live evidence shows the PR author equals the authenticated viewer, or an explicit maintainer-overtake workflow has transferred operational ownership. `maintainerCanModify` alone does not make another author's branch ours. Base-sync pushes and simplification edits apply only to branches we are authorized to mutate.

### GD-GIT-005 — Unwritable fork heads are a hard stop

If the authorized workflow requires changing a fork head and the authenticated actor cannot write that head, stop and provide owner instructions instead of manufacturing a replacement mutation path.

### GD-GIT-006 — Compile and test against the current tip

Before readiness or merge, update topology as required, then verify build/tests against the resulting current base/parent tip. A green result on an old SHA is not enough.

### GD-GIT-007 — Automatic branch deletion is disabled

Do not automatically delete a merged PR head branch. GitHub's ref-delete API does not expose an expected-tip compare-and-delete precondition, so a branch can advance after cleanup is authorized but before deletion reaches GitHub. Keep the branch and report that automatic cleanup is disabled until the delete operation can be atomically bound to the expected remote tip. Never convert a prior cleanup decision into authority to delete a later branch generation.

### GD-GIT-008 — Content-preserving rewrites keep the original tree

Non-fast-forward force-with-lease `push_code` fails closed unless the new tip tree matches the previous tip or `rewriteExemption` is restack, conflicts, or simplify-pr.
