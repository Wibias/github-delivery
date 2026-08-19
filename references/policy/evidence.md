# Evidence Policy

Canonical rules for snapshots, pagination, freshness, and final verification.

### GD-EVID-001 — Required evidence must be complete

When a workflow declares evidence required, missing, unreadable, truncated, stale, or internally inconsistent evidence blocks the claim. Do not manufacture a complete snapshot from partial reads.

### GD-EVID-002 — Verify snapshot boundaries

Capture the PR head and immediate base at the beginning and re-read both at the end of evidence collection. Any head movement, base retarget, or material state change invalidates the snapshot and requires a fresh capture.

### GD-EVID-003 — Paginate to exhaustion

GitHub collections that affect scope, feedback, checks, reviews, comments, or policy must be paginated until exhausted. Hitting a safety limit or failing a later page makes the evidence incomplete.

### GD-EVID-004 — Mutations invalidate stale evidence

After a push, rebase, restack, force-with-lease, approval/thread change, draft/state change, reviewer change, or newly discovered workflow, re-read the evidence affected by that mutation before making a readiness or merge claim.

### GD-EVID-005 — Unknown is not green

Pending, missing, unrecognized, or unverifiable evidence is `unknown`, not pass. Known blockers outrank unknown evidence, but unknown still prevents a positive final claim once known blockers are cleared.

### GD-EVID-006 — Finish with the authoritative gate

Before claiming merge-ready or merging, the final `ship-gate.mjs` result must be `ready` on unchanged relevant heads/state. Component helpers diagnose; they do not overrule the authoritative gate.

### GD-EVID-007 — Bind lightweight remote repository context to an immutable snapshot

When a workflow needs GitHub repository context and no useful local checkout is already available, apply `references/repository-context.md`. Resolve the repository's actual default branch, or the workflow-selected branch when one is required, then capture its exact commit SHA and bind substantive remote file reads to that SHA. Do not guess `main`, `master`, or `HEAD`.

Lightweight remote reads can establish targeted documentation or source evidence. They cannot by themselves prove history, runtime behavior, exhaustive repository coverage, or a modification result. Escalate to a local fetch/checkout when the selected workflow needs evidence that the remote path cannot prove complete.
