# Fix PR bots → merge-ready

**Trigger:** “review my pr #N - fix coderabbit/codex…”, “make PR #N merge ready”, “babysit these PRs until merge ready”, bot-fix loops aimed at merge-ready (not watch-until-merged).

## Goal

Necessary/useful **human** (esp. owners/maintainers) + CodeRabbit/Codex comments addressed, **own bug + security review** done (same bar as create-PR / full-review), branch not behind/conflicted, CLI + required CI green, then a merge-ready summary — unless a draft/WIP/do-not-merge gate blocks it. Do **not** merge.

**Keep going until merge-ready** (or a hard blocker). Do **not** stop after an arbitrary round count or wall-clock budget.

## Targets

- Default: one PR (`#N`).
- If the user explicitly lists several **existing** PRs to babysit/make merge-ready: work each until merge-ready or hard-blocked. Report a per-PR table when done.
- **>3 PRs:** fan out with **subagents** (shared **Multi-PR fan-out**) — one PR per subagent in parallel (chunk if rate-limited). Do not serialize 4+ in the parent.

## Steps

1. Identify PR(s), checkout head, note base/default branch, list **linked issues** (`closingIssuesReferences` / `Fixes #N`).
2. Apply **draft/WIP/do-not-merge** awareness (shared rules). Work may continue; **ask once** about converting draft→ready when the user wanted merge-ready (shared **Draft → ready**). Do not claim final merge-ready while gated.
3. **Behind base + compile against tip:** update from base if needed; run local compile/typecheck/focused tests against tip; push; wait for required CI on the new SHA. If tip broke the branch, fix or hard-block — never claim ready while stale or non-compiling.
4. Collect unresolved review threads via `scripts/review-threads.mjs` (owners/maintainers first, then other humans, then bots). Skip resolved/outdated.
5. Triage and fix necessary/useful items (trusted humans first; verify bots). For human declines needing a written reply: confirm exact text in chat first (shared social policy). Bot skip notes may use `[shipping-github]` prefix.
6. Push fixes (git safety: no force-push; stop if rejected / dirty unrelated tree / **fork-head unwritable**). After push: `pr-policy-gate.mjs` for stale-approval / last-push.
7. **Wait and recheck** — new useful comments or red required CI → fix/push again. Repeat until stable **or** a hard blocker (shared rules). No “3 rounds then quit.” Poll CI ~1 min; expect `windows-latest` ~12–15 min — do **not** sleep a fixed 20 min after CI started.
8. Fix CLI / project / **required CI** failures on this head — including ones introduced elsewhere or outside this PR’s feature files (shared rules scope lock + CI classify). Classify CI: branch fix vs flake (shared rules; flake reruns still max 3 / SHA). Apply **Required checks + review gate** + policy gate (code-owner enforcement, merge queue).
9. **Own reviews (required — not optional):**
   - Subagent **preflight** (checkout PR head; stash only with user OK) — shared rules.
   - **Bug:** run **`references/bug-review.md`** (`bug-scope.mjs` → Bugbot when Cursor → complementary lenses). Never fake Bugbot on Claude/Codex; never auto deep multi-agent kits.
   - **Security:** run **`references/security-review.md`** (scope script + matrix). **Never** Cursor harness `security-review` / `review-security`.
   - **Spec + Standards:** run or hand off skill `review` against PR base/merge-base (shared rules). Fix necessary gaps.
   - Triage findings; fix what can/should land in this PR; skip 0.1% nits. Public request-changes / comments stay redacted for exploit detail. Changelog nudge when user-facing.
10. Recheck human/bot threads (`review-threads.mjs`) + required CI after any review-driven pushes (loop again if needed). Apply **rate-limit backoff** (Composio `GITHUB_GET_GRAPHQL_RATE_LIMIT` → `gh api rate_limit`) on dense polls. If **stacked**, label ready-vs-parent vs trunk; trunk merge → `manage-stacked-prs`. If **in merge queue**, keep watching until merged (do not stop at queued).
11. Bot/human **inline** replies go in-thread (shared rules), never as duplicate top-level comments.
12. **Final evidence sweep** (shared rules + gate helpers). **Refuse merge-ready** while useful bot/human threads remain open (or only “rate-limited / summary” without triage), while protection/enforced CODEOWNERS/stale-approval/merge-queue blocks, or while own bug/security/spec findings that should block merge are unfixed. CI green alone is not enough.
13. **Thin settle** (shared rules): after the sweep would allow ready, wait ~3–5 min quiet (~4 default; stretch once if bot in-progress), recheck threads + CI. Activity resets the clock. Cap at two settle windows, then post. Do **not** skip settle for merge-ready.
14. If truly ready after settle, post on the **PR** (idempotent — edit prior merge-ready if one exists; fix malformed `\` escapes by edit). Use the **Merge ready** template in `references/comment-depth.md` — evidence for reviews, tip freshness, checks, residual. Not a yes/no stub.

15. **Notify linked issue(s)** (required when merge-ready is posted): for each linked issue, one idempotent comment using the **Merge-ready notify** template in `comment-depth.md` (edit if a prior note exists — never a second/cut-off comment).

If there are no linked issues, skip and say so in chat.

If still draft/WIP/do-not-merge, open bot threads, or hard-blocked: **do not** post merge-ready (PR or issue); explain the blocker and keep going if clearable.

For monitoring **after** merge-ready while the PR stays open (new late comments), hand off to `watch-pr` if the user wants that.

## Done when

- Every targeted PR has a valid merge-ready PR comment **and** linked-issue notify (or a clear hard blocker — no false merge-ready)
- Useful human + bot threads handled (or declined with policy) before any merge-ready claim
- Own **bug + security + Spec/Standards** reviews completed; necessary findings fixed
- Branch not conflicted / not behind / **compiles against current tip** (when claiming ready)
- CLI + required CI green (when claiming ready)
- **Thin settle** completed (or two-window cap) before the merge-ready claim
- PR(s) **not** merged
