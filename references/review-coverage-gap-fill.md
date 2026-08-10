# Review coverage gap-fill

Use gap-fill after the first review pass to close **specific missing coverage**, not to multiply reviewers indiscriminately.

The planner is `scripts/lib/review-coverage-gap-fill.mjs`.

## Coverage cells

Represent required work as concrete cells:

- file × bug lens;
- file × security surface;
- file × required probe.

When scope evidence already names trigger files for a lens/surface/probe, use those files rather than expanding the obligation across every changed file.

## Closed vs open

Closed evidence includes completed/clean/findings/confirmed/dismissed outcomes. `n-a` closes a required cell only when it includes a concrete reason.

These remain open:

- `manual-review`;
- `unreviewed`;
- `needs-more-evidence`;
- `unknown`;
- missing evidence;
- invalid `n-a` without a reason.

## Gap-fill execution

For each open cell:

1. Pick the narrowest reviewer, tool, or executable verification method capable of settling it.
2. Give that lane only the source/context needed for the missing cell plus structured existing evidence.
3. Do not re-run completed low-risk cells simply because another reviewer is available.
4. Persist the resulting evidence and recompute the gap set.
5. Stop when all required cells are closed or the remaining cells are explicitly carried as unresolved/manual blockers.

A second reviewer is useful when it contributes **independent evidence for uncertainty**, not when it repeats already-covered work.

## Fail closed

A review cannot claim complete/clean coverage while `targets[]` is non-empty. Tool absence is a limitation to record, not permission to silently drop the cell.
