# Watch / babysit PR

**Trigger:** “babysit pr #N”, “watch pr #N”, “monitor CI and reviews on #N”, “keep an eye on this PR”.

## Goal

Persistently monitor an open PR: new **published** review feedback, required CI, mergeability/conflicts. Fix what is safe to auto-fix. **Green + mergeable is a CI/review milestone, not the full merge-ready bar** — and not a stop — while the PR stays open.

If the user asked only for **merge-ready**, use `fix-pr-bots` instead (runs until merge-ready, then stops).

Do **not** merge unless they also asked to merge (then hand off to `merge-pr` only after merge-ready bar / explicit override).

## Relation to other workflows

| Intent | Workflow |
|---|---|
| Keep fixing until merge-ready (then stop) | `fix-pr-bots` — **no** early exit on round/time caps |
| Read-only snapshot | `status` |
| Keep watching after green until merged/closed | **this file** |

## Targets

- Default: one PR.
- If the user lists **>3** PRs to watch/babysit: fan out with **subagents** (shared **Multi-PR fan-out**). ≤3 may stay in the parent.

## Loop

1. Identify PR (`#N`, URL, or current branch) — resolve bare `#N` per shared rules. Checkout head if fixing.
2. Apply git safety (dirty tree / no force-push / fork-head unwritable → hard stop).
3. Snapshot: draft/WIP gates, behind-base/conflicts, required CI + review gate (`required-checks` + `pr-policy-gate`), unresolved threads (`review-threads.mjs`), stack/fork/auto-merge/**merge-queue** flags.
4. **Reviews first:** triage per shared rules (owners/trusted first). Patch+push actionable items. Human written replies → chat confirm. Inline replies in-thread. Resolve only allowed threads after verified fixes (`review-threads --resolve` only when policy allows).
5. **CI:** classify branch vs flake. Fix branch-related; rerun flakes (max 3 / SHA); stop on exhausted infra failures. After push: re-check stale-approval / last-push via `pr-policy-gate`.
6. If behind/conflicted: update from base, resolve or ask, push; verify compile-against-tip when updating.
7. Security-offer / changelog nudge once if applicable.
8. If green + mergeable + useful threads quiet on **current** SHA: report milestone **“CI/reviews quiet — still watching (not full merge-ready bar)”** (stacked: “quiet vs parent — not trunk”). Do **not** post `[shipping-github] Merge ready` from watch alone. Keep polling while open. If auto-merge **or merge-queue** queued: watch until **actually merged** (report queue position/state from `pr-policy-gate`).
9. Stop only when:
   - PR **merged** or **closed**, or
   - Hard blocker (permissions, fork-head unwritable, dirty unrelated tree, push rejected, flake budget exhausted, product decision, human reply needs confirmation, stack needs `manage-stacked-prs` for trunk, merge-queue stuck with `merge_group` CI gap), or
   - User interrupts / asks to stop.

## Cadence

- CI pending/failing: poll ~1 minute (longer if rate-limit remaining is low — shared **Rate-limit backoff**).
- Before dense multi-PR / watch polls: check Composio `GITHUB_GET_GRAPHQL_RATE_LIMIT` (or `gh api rate_limit` / GraphQL `rateLimit`).
- CI green, PR still open: keep polling at a practical interval (~1–2 minutes) for new reviews/conflicts — don’t abandon the watch.
- On any change (new SHA, check flip, new comment): reset and act; re-verify tip freshness before repeating milestone language.
- Heartbeat only on status **changes**, not every identical green poll.

## Done when

- Terminal: merged/closed reported, **or**
- Blocker reported with clear next human action, **or**
- User stopped the watch

Never treat a single green snapshot as the end of babysitting while the PR is still open.
Never equate a watch milestone with merge-ready unless `fix-pr-bots` / `full-review-pr` already completed the full bar this session.
