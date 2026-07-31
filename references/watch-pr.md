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

### Forbidden (instant fail)

These progress lines are **illegal** while an OWNER / MEMBER / COLLABORATOR / CODEOWNER comment is still untriaged:

- “up to date with `dev`; waiting on CI / windows-latest”
- “waiting on CodeRabbit / Codex”
- “tip is current; polling until green”

**Correct** when owner feedback is open: act on it (patch / rebase / drop duplicated scope / ask user) **now**. Only after that may you wait on CI or bots.

Owner guidance is often a **top-level PR conversation comment** (not an inline review thread). Fetch `gh api repos/…/issues/N/comments` (or `gh pr view --comments`) every wake — `review-threads.mjs` alone is **not** enough.

### Wake gate (before any “waiting…” report)

Every poll / user update must pass this checklist **in order**. If any step fails, that is your action — do **not** emit a wait heartbeat.

1. List unresolved **inline** threads (`review-threads.mjs`).
2. List recent **top-level** PR comments; flag any from OWNER/MEMBER/COLLABORATOR/CODEOWNERS since last handled SHA / last agent action.
3. If any flagged human feedback is untriaged → **stop gate**: triage + fix/push or surface to user. Do not proceed to CI wait.
4. Only if human/owner queue is clear: tip-update if behind, then CI classify/fix/wait, then bot triage.

CodeRabbit/Codex pending is **lower priority** than an open owner comment. Never wait on bots while owner text is unanswered in code or chat.

## Loop

On **every** poll / wake (including the first):

1. Identify PR (`#N`, URL, or current branch) — resolve bare `#N` per shared rules. Checkout head if fixing.
2. Apply git safety (dirty tree / no force-push / fork-head unwritable → hard stop).
3. Snapshot: draft/WIP gates, behind-base/conflicts, required CI + review gate, unresolved threads, **top-level PR comments**, stack/fork/auto-merge/**merge-queue** flags.
4. Run **Wake gate** (above). Fail → handle reviews; do not idle.
5. **Reviews first (mandatory):** triage per shared rules — **CODEOWNERS / owners / maintainers first**, then other humans, then bots.
   - Patch+push actionable items (narrow scope / drop work already on tip / rebase per owner note).
   - Human written replies → chat confirm. Inline replies in-thread. Resolve only allowed threads after verified fixes.
6. **Then** if behind/conflicted: update from base, resolve or ask, push; verify compile-against-tip. Prefer combining with review fixes in the **same** push.
7. **Then CI:** classify branch vs flake. Fix branch-related; rerun flakes (max 3 / SHA); stop on exhausted infra failures. After push: re-check stale-approval / last-push via `pr-policy-gate`.
8. Security-offer / changelog nudge once if applicable.
9. Only if green + mergeable + **useful threads/comments quiet** on **current** SHA: report milestone **“CI/reviews quiet — still watching (not full merge-ready bar)”**. Do **not** post `[shipping-github] Merge ready` from watch alone. Keep polling while open. If auto-merge **or merge-queue** queued: watch until **actually merged**.
10. Stop only when:
   - PR **merged** or **closed**, or
   - Hard blocker (permissions, fork-head unwritable, dirty unrelated tree, push rejected, flake budget exhausted, product decision, human reply needs confirmation, stack needs `manage-stacked-prs` for trunk, merge-queue stuck with `merge_group` CI gap), or
   - User interrupts / asks to stop.

## Cadence

- **Open actionable reviews:** act immediately; do not burn the poll interval “waiting for CI” or “waiting for CodeRabbit.”
- CI pending/failing **and** wake gate clear: poll ~1 minute (longer if rate-limit remaining is low).
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
