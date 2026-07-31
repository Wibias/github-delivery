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

## Hard ordering (do not invert)

**Reviews → then base update if needed → then CI/bots.** Never the reverse.

### Mandatory script (every wake)

```bash
node "<shipping-github>/scripts/watch-wake-gate.mjs" OWNER/REPO N
```

- **Exit `1` / `canWait: false`:** you are **forbidden** to say you are waiting on CI, `windows-latest`, CodeRabbit, or Codex. Act on `blockers[]`:
  - `trusted_human_comment_needs_code` — owner/member said something actionable (including “half landed elsewhere, keep the rest”): **rebase onto tip, drop duplicated work, keep leftovers, fix conflicts, push**. Do **not** only post an ACK comment.
  - `base_dirty_or_behind` — `DIRTY` / `CONFLICTING` / `BEHIND`: update from base and resolve **now**. Polling while conflicted is forbidden.
  - Optional paper trail **after** the fix commit:

    ```markdown
    [shipping-github] Addressed owner feedback — <one line what changed on tip>
    ```

  - **ACK-only does not clear the gate** (script requires a later non-merge commit).

- **Exit `0`:** CI/bot wait is allowed.
- Re-run this script after every push and before every progress heartbeat.

This exists because prose “reviews first” was ignored, and ACK-without-fix was gamed. **The exit code is the rule.**

### Forbidden (instant fail)

These progress lines are **illegal** while the wake-gate exits `1` (or while `mergeStateStatus` is DIRTY/CONFLICTING/BEHIND):

- “up to date with `dev`; waiting on CI / windows-latest”
- “waiting on CodeRabbit / Codex”
- “tip is current; polling until green”
- “acknowledged owner feedback; leaving open; keeping an eye out” **without** a follow-up fix commit / conflict resolution
- “DIRTY / conflicting — expected; still watching” — conflicts are work, not a spectator sport

Owner “left open because leftover work remains” means **do the leftover work on tip** (or hard-block to the user with why you can’t), not acknowledge and poll.

### Wake gate checklist

1. Run `watch-wake-gate.mjs` — if exit `1`, handle blockers; stop.
2. Also list unresolved **inline** threads (`review-threads.mjs`).
3. Only if human/owner queue is clear: tip-update if behind, then CI classify/fix/wait, then bot triage.

CodeRabbit/Codex pending is **lower priority** than an open owner comment.

## Loop

On **every** poll / wake (including the first):

1. Identify PR (`#N`, URL, or current branch) — resolve bare `#N` per shared rules. Checkout head if fixing.
2. Apply git safety (dirty tree / no force-push / fork-head unwritable → hard stop).
3. Snapshot + **run `scripts/watch-wake-gate.mjs`** (exit `1` → handle owner blockers; do not idle). Also: draft/WIP, behind-base, required CI, `review-threads.mjs`, stack/fork/queue flags.
4. Run **Wake gate** path above. Fail → handle reviews; do not idle.
5. **Reviews first (mandatory):** triage per shared rules — **CODEOWNERS / owners / maintainers first**, then other humans, then bots.
   - Patch+push actionable items (narrow scope / drop work already on tip / rebase per owner note).
   - Human written replies → chat confirm. Inline replies in-thread. Resolve only allowed threads after verified fixes.
6. **Then** if behind/conflicted **or** wake-gate reports `base_dirty_or_behind`: update from base, resolve or ask, push; verify compile-against-tip. Prefer combining with review fixes in the **same** push. **Never** enter the 1–2 min poll loop while `DIRTY`/`CONFLICTING`.
7. **Then CI:** classify branch vs flake. Fix branch-related **and** pre-existing/“unrelated” required failures (minimal patch); rerun flakes (max 3 / SHA); stop on exhausted infra failures. After push: re-check stale-approval / last-push via `pr-policy-gate`.
8. Security-offer / changelog nudge once if applicable.
9. Only if green + mergeable + **useful threads/comments quiet** on **current** SHA **and** wake-gate exit `0`: report milestone **“CI/reviews quiet — still watching (not full merge-ready bar)”**. Do **not** post `[shipping-github] Merge ready` from watch alone. Keep polling while open. If auto-merge **or merge-queue** queued: watch until **actually merged**.
10. Stop only when:
   - PR **merged** or **closed**, or
   - Hard blocker (permissions, fork-head unwritable, dirty unrelated tree, push rejected, flake budget exhausted, product decision, human reply needs confirmation, stack needs `manage-stacked-prs` for trunk, merge-queue stuck with `merge_group` CI gap), or
   - User interrupts / asks to stop.

**Partial land on another branch:** if the owner says most of the fix already merged elsewhere and left this PR open for leftovers — rebase onto current base, remove duplicated changes, implement/keep only the remaining delta, push, re-run wake-gate. Acknowledging in a comment without that rebase is a failed watch turn.

## Cadence

- **Open actionable reviews:** act immediately; do not burn the poll interval “waiting for CI” or “waiting for CodeRabbit.”
- CI pending/failing **and** wake gate clear: poll ~1 minute (longer if rate-limit remaining is low). Expect `windows-latest` often **~12–13 min**, typically done by **~15 min** — do **not** sleep a fixed 20 min after CI started (shared **CI wait expectations**).
- Before dense multi-PR / watch polls: check Composio `GITHUB_GET_GRAPHQL_RATE_LIMIT` (or `gh api rate_limit` / GraphQL `rateLimit`).
- CI green, PR still open: keep polling (~1–2 minutes) for new reviews/conflicts.
- On any change (new SHA, check flip, **new comment**): reset to wake gate; **re-run reviews-first**.
- Heartbeat only when wake gate is clear **and** status changed — never a wait line that skips owner triage.

## Done when

- Terminal: merged/closed reported, **or**
- Blocker reported with clear next human action, **or**
- User stopped the watch

Never treat a single green snapshot as the end of babysitting while the PR is still open.
Never equate a watch milestone with merge-ready unless `fix-pr-bots` / `full-review-pr` already completed the full bar this session.
Never report “waiting for CI/CodeRabbit” while unresolved owner/CODEOWNER/top-level trusted-human comments remain.
