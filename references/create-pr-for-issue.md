# Create PR for issue → merge-ready

**Trigger:** “Create a pr for issue #N with all coderabbit + codex fixes…”, “make issue #N merge ready but don’t merge”.

## Goal

Open a PR that fixes issue `#N`, clear bot review rounds, run full + security review via subagents, get CI green, leave it merge-ready. Do **not** merge.

## Screenshot gate

1. Check the issue (and linked discussion) for author screenshots/images.
2. **If there are screenshots:** review them (read the images). If you cannot review them, **stop — do not create a PR**.
3. **If there are no screenshots:** ignore the screenshot requirement and continue.

## Steps

1. Pass the screenshot gate.
2. Research briefly (reuse `research-issue` instincts): confirm it still needs a fix on the target branch.
3. Implement the fix on a branch; open the PR linked to `#N` with `Fixes #N` (or repo equivalent) so merge can auto-close. Use subagents when helpful.
4. Keep the branch up to date with base; resolve conflicts early.
5. Run review wait-loop (`fix-pr-bots` pattern): **owners/maintainers + humans + bots**, push, wait (caps), repeat.
6. Fix CLI / project checks; push until required CI green.
7. Full review + security review with **subagents** (parallel). Fix everything that can and should be fixed in this PR; skip 0.1% nits.
8. Changelog nudge if user-facing (shared rules).
9. Recheck reviews + CI after fixes.
10. Post merge-ready comment (or gated status). Do not merge.

## Done when

- Screenshot gate passed (or N/A)
- PR open for the issue with Fixes/Closes linkage when possible
- Useful owner/human + bot threads handled, base clean, CLI + required CI green
- Full + security review done; necessary fixes landed
- Merge-ready comment posted (or gate explained); **not** merged
