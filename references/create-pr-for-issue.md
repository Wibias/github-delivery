# Create PR for issue → merge-ready

**Trigger:** “Create a pr for issue #N … merge ready, don’t merge”.

## Goal

Open **one** PR on the **canonical** (issue’s) repository that fixes issue `#N`, with verified bidirectional linking, self-assignment, review/CI cleanup, merge-ready. Do **not** merge. Do **not** batch other issues’ PRs unless the user explicitly demanded a batch.

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

## Open PR on the issue’s repo (required)

1. Resolve `owner/repo` from the **issue** (not from a fork remote you happen to be in).
2. Base branch = that repo’s development/default as appropriate.
3. Push the head branch (upstream if you can; else fork head is OK).
4. Create with explicit repo, e.g.:

   ```bash
   gh pr create --repo OWNER/REPO --base <base> --head <head> \
     --title "…" --body "$(cat <<'EOF'
   ## Summary
   …

   Fixes #N

   ## Test plan
   - [ ] …
   EOF
   )"
   ```

5. Confirm the PR URL is `https://github.com/OWNER/REPO/pull/…` (same OWNER/REPO as the issue). If it is `https://github.com/<your-fork>/…` only: **wrong** — close it and recreate against `OWNER/REPO`.

## Issue ↔ PR linking + assign (required)

After the canonical PR exists:

1. **PR → issue:** body contains same-repo `Fixes #N` or `Closes #N`.
2. **Verify link:**

   ```bash
   gh pr view <pr> --repo OWNER/REPO --json number,url,body,closingIssuesReferences
   ```

   `closingIssuesReferences` must include issue `#N`. If empty: edit the PR body to add `Fixes #N` on its own line, re-check.

3. **Assign yourself** on the issue:

   ```bash
   gh issue edit N --repo OWNER/REPO --add-assignee @me
   ```

   If assign fails (permissions), report once and continue.

4. **One issue comment** (idempotent — edit if a prior `[shipping-github] Opened PR` exists; never a second/cut-off comment):

   ```markdown
   [shipping-github] Opened PR #<pr> to address this.
   ```

5. Spot-check the issue Development sidebar / linked PRs still point at the **canonical** PR (not a closed fork duplicate).

## Steps

1. Confirm this request is **one** issue (or an explicit batch). Otherwise pick/ask — do not open extra PRs.
2. Need-to-fix preflight → report; abort create if not needed.
3. Pass the screenshot gate.
4. Implement; open **canonical** PR with `Fixes #N`; assign self; one opened-PR comment (edit-not-duplicate).
5. Keep branch up to date with base; resolve conflicts early.
6. Review wait-loop (`fix-pr-bots`): owners/maintainers + humans + bots; push; keep going until merge-ready or a hard blocker.
7. Fix CLI / project checks; push until required CI green.
8. Full review + security review with **subagents** (parallel). Fix what can/should land here; skip 0.1% nits.
9. Changelog nudge if user-facing (shared rules).
10. Recheck reviews + CI.
11. Post merge-ready comment (idempotent). Do not merge.

## Done when

- Exactly the requested PR count (default **one**); no surprise batch
- PR on **issue’s** repo (not fork-only)
- `closingIssuesReferences` includes the issue; self assigned when possible
- Single complete opened-PR comment (no duplicates/cut-offs)
- Screenshot gate passed (or N/A); reviews + CI green; merge-ready posted; **not** merged
