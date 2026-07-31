# Fix PR bots → merge-ready

**Trigger:** “review my pr #N - fix coderabbit/codex…”, “make PR #N merge ready”, “babysit these PRs until merge ready”, bot-fix loops aimed at merge-ready (not watch-until-merged).

## Goal

Necessary/useful **human** (esp. owners/maintainers) + CodeRabbit/Codex comments addressed, **own bug + security review** done (same bar as create-PR / full-review), branch not behind/conflicted, CLI + required CI green, then a merge-ready summary — unless a draft/WIP/do-not-merge gate blocks it. Do **not** merge.

**Keep going until merge-ready** (or a hard blocker). Do **not** stop after an arbitrary round count or wall-clock budget.

## Targets

- Default: one PR (`#N`).
- If the user explicitly lists several **existing** PRs to babysit/make merge-ready: work each until merge-ready or hard-blocked. Report a per-PR table when done.

## Steps

1. Identify PR(s), checkout head, note base/default branch, list **linked issues** (`closingIssuesReferences` / `Fixes #N`).
2. Apply **draft/WIP/do-not-merge** awareness (shared rules). Work may continue; **ask once** about converting draft→ready when the user wanted merge-ready (shared **Draft → ready**). Do not claim final merge-ready while gated.
3. **Behind base + compile against tip:** update from base if needed; run local compile/typecheck/focused tests against tip; push; wait for required CI on the new SHA. If tip broke the branch, fix or hard-block — never claim ready while stale or non-compiling.
4. Collect unresolved review threads via `scripts/review-threads.mjs` (owners/maintainers first, then other humans, then bots). Skip resolved/outdated.
5. Triage and fix necessary/useful items (trusted humans first; verify bots). For human declines needing a written reply: confirm exact text in chat first (shared social policy). Bot skip notes may use `[shipping-github]` prefix.
6. Push fixes (git safety: no force-push; stop if rejected / dirty unrelated tree / **fork-head unwritable**). After push: `pr-policy-gate.mjs` for stale-approval / last-push.
7. **Wait and recheck** — new useful comments or red required CI → fix/push again. Repeat until stable **or** a hard blocker (shared rules). No “3 rounds / 20 min then quit.”
8. Fix CLI / project checks this PR broke. Classify CI: branch fix vs flake (shared rules; flake reruns still max 3 / SHA). Apply **Required checks + review gate** + policy gate (code-owner enforcement, merge queue).
9. **Own reviews (required — not optional):**
   - Subagent **preflight** (checkout PR head; stash only with user OK) — shared rules.
   - Parallel: bug + security (`review-bugbot` / `review-security`).
   - **Spec + Standards:** run or hand off skill `review` against PR base/merge-base (shared rules). Fix necessary gaps.
   - Triage findings; fix what can/should land in this PR; skip 0.1% nits. Public request-changes / comments stay redacted for exploit detail. Changelog nudge when user-facing.
10. Recheck human/bot threads (`review-threads.mjs`) + required CI after any review-driven pushes (loop again if needed). Apply **rate-limit backoff** (Composio `GITHUB_GET_GRAPHQL_RATE_LIMIT` → `gh api rate_limit`) on dense polls. If **stacked**, label ready-vs-parent vs trunk; trunk merge → `manage-stacked-prs`. If **in merge queue**, keep watching until merged (do not stop at queued).
11. Bot/human **inline** replies go in-thread (shared rules), never as duplicate top-level comments.
12. **Final evidence sweep** (shared rules + gate helpers). **Refuse merge-ready** while useful bot/human threads remain open (or only “rate-limited / summary” without triage), while protection/enforced CODEOWNERS/stale-approval/merge-queue blocks, or while own bug/security/spec findings that should block merge are unfixed. CI green alone is not enough.
13. If truly ready, post on the **PR** (idempotent — edit prior merge-ready if one exists; fix malformed `\` escapes by edit):

```markdown
## [shipping-github] Merge ready

- Human review (trusted/owners first): addressed / declined (chat-confirmed if human reply)
- Bot review (CodeRabbit/Codex): addressed / declined with rationale (0 unresolved useful threads)
- Own bug + security + spec/standards: done; blockers fixed / none
- Base: up to date with tip; compiles/tests against tip; conflicts resolved (`mergeStateStatus: CLEAN` when applicable — backticks only)
- CLI / local checks: green
- Required CI: green (flaky retries used: N; name jobs in backticks)

Ready to merge.
```

14. **Notify linked issue(s)** (required when merge-ready is posted): for each linked issue, one idempotent comment (edit if a prior “PR is merge-ready” note exists — never a second/cut-off comment):

```markdown
## [shipping-github] PR merge-ready

PR #<pr> is merge-ready (reviews + required CI clean). Not merged yet.
```

If there are no linked issues, skip and say so in chat.

If still draft/WIP/do-not-merge, open bot threads, or hard-blocked: **do not** post merge-ready (PR or issue); explain the blocker and keep going if clearable.

For monitoring **after** merge-ready while the PR stays open (new late comments), hand off to `watch-pr` if the user wants that.

## Done when

- Every targeted PR has a valid merge-ready PR comment **and** linked-issue notify (or a clear hard blocker — no false merge-ready)
- Useful human + bot threads handled (or declined with policy) before any merge-ready claim
- Own **bug + security + Spec/Standards** reviews completed; necessary findings fixed
- Branch not conflicted / not behind / **compiles against current tip** (when claiming ready)
- CLI + required CI green (when claiming ready)
- PR(s) **not** merged
