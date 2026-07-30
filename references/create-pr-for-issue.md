# Create PR for issue → merge-ready

**Trigger:** “Create a pr for issue #N … merge ready, don’t merge”.

## Goal

Open a PR that fixes issue `#N`, with **bidirectional** issue↔PR linking, clear bot/human review rounds, full + security review, CI green, merge-ready. Do **not** merge.

## Need-to-fix preflight (required — report before coding)

Before screenshots or implementation, run a **research preflight** (same checks as `research-issue`, can be lighter but must answer these and **tell the user**):

1. Still needed on **latest development branch** tip?
2. Already fixed on development (cite SHA/PR)?
3. Open PR already covering this issue?
4. Obvious duplicate of another issue?

**Then stop and report** the preflight to the user:

| Outcome | Action |
|---|---|
| Already fixed / shipped / fixed on development | **Do not create a PR.** Report evidence; offer release backport only if they ask |
| Open PR already exists | **Do not create a duplicate.** Link the PR; offer to watch/fix that PR instead |
| Duplicate issue | **Do not create a PR** on the duplicate; point at the canonical issue |
| Still needs fix | Continue (screenshot gate → implement) |

If preflight is unclear, say what’s missing; do not open a speculative PR.

## Screenshot gate

1. Check the issue (and linked discussion) for author screenshots/images.
2. **If there are screenshots:** review them (read the images). If you cannot review them, **stop — do not create a PR**.
3. **If there are no screenshots:** ignore the screenshot requirement and continue.

## Issue ↔ PR linking (required)

When opening the PR:

1. **PR → issue:** body must include a closing keyword, e.g. `Fixes #N` or `Closes #N` (use the repo’s convention).
2. **Issue → PR:** after create, ensure GitHub shows the link (closing keywords usually do). Also leave a short issue comment:

   ```markdown
   [shipping-github] Opened PR #<pr> to address this.
   ```

3. Verify with `gh pr view` / `gh issue view` that the cross-link is visible. If not, edit the PR body to add `Fixes #N` and re-check.

## Steps

1. Need-to-fix preflight → report to user; abort create if not needed.
2. Pass the screenshot gate.
3. Implement on a branch from the correct base; open PR with `Fixes #N` (+ issue comment). Use subagents when helpful.
4. Keep the branch up to date with base; resolve conflicts early.
5. Review wait-loop (`fix-pr-bots` pattern): owners/maintainers + humans + bots; push; wait (caps); repeat.
6. Fix CLI / project checks; push until required CI green.
7. Full review + security review with **subagents** (parallel). Fix what can/should land here; skip 0.1% nits.
8. Changelog nudge if user-facing (shared rules).
9. Recheck reviews + CI.
10. Post merge-ready comment (or gated status). Do not merge.

## Done when

- Preflight reported; PR only created when still needed
- Issue↔PR linked both ways (closing keyword + verified; issue comment)
- Screenshot gate passed (or N/A)
- Useful reviews handled, base clean, CLI + required CI green
- Full + security review done; merge-ready comment posted; **not** merged
