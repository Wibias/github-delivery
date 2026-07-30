# Fix PR bots → merge-ready

**Trigger:** “review my pr #N - fix coderabbit/codex…”, “make PR #N merge ready”, “babysit these PRs until merge ready”, bot-fix loops aimed at merge-ready (not watch-until-merged).

## Goal

Necessary/useful **human** (esp. owners/maintainers) + CodeRabbit/Codex comments addressed, branch not behind/conflicted, CLI + required CI green, then a merge-ready summary — unless a draft/WIP/do-not-merge gate blocks it. Do **not** merge.

**Keep going until merge-ready** (or a hard blocker). Do **not** stop after an arbitrary round count or wall-clock budget.

## Targets

- Default: one PR (`#N`).
- If the user explicitly lists several **existing** PRs to babysit/make merge-ready: work each until merge-ready or hard-blocked. Report a per-PR table when done.

## Steps

1. Identify PR(s), checkout head, note base/default branch.
2. Apply **draft/WIP/do-not-merge** awareness (shared rules). Work may continue; do not claim final merge-ready while gated.
3. **Behind base + conflicts:** update from base if needed; resolve or stop and ask.
4. Collect unresolved review threads: owners/maintainers first, then other humans, then bots. Skip resolved/outdated.
5. Triage and fix necessary/useful items (trusted humans first; verify bots). For human declines needing a written reply: confirm exact text in chat first (shared social policy). Bot skip notes may use `[shipping-github]` prefix.
6. Push fixes (git safety: no force-push; stop if rejected / dirty unrelated tree).
7. **Wait and recheck** — new useful comments or red required CI → fix/push again. Repeat until stable **or** a hard blocker (shared rules). No “3 rounds / 20 min then quit.”
8. Fix CLI / project checks this PR broke. Classify CI: branch fix vs flake (shared rules; flake reruns still max 3 / SHA).
9. Security-offer + changelog nudge when applicable.
10. **Final evidence sweep** (shared rules). If gates clear and checks green, post (idempotent — edit prior merge-ready comment if one exists):

```markdown
## [shipping-github] Merge ready

- Human review (trusted/owners first): addressed / declined (chat-confirmed if human reply)
- Bot review (CodeRabbit/Codex): addressed / declined with rationale
- Base: up to date / conflicts resolved (`mergeStateStatus: CLEAN` when applicable — use backticks, never `\mergeStateStatus`)
- CLI / local checks: green
- Required CI: green (flaky retries used: N; name flaky jobs in backticks, e.g. `previewArchivedCleanup`)

Ready to merge.
```

Do **not** post merge-ready as a slash-escaped bullet dump. If a prior merge-ready comment is malformed (stray `\`, truncated), **edit** it to the template above.
If still draft/WIP/do-not-merge or hard-blocked: explain the blocker; keep trying only if the blocker is clearable (e.g. wait for CI); otherwise report and move to the next targeted PR if any.

For monitoring **after** merge-ready while the PR stays open (new late comments), hand off to `watch-pr` if the user wants that.

## Done when

- Every targeted PR has merge-ready posted **or** a clear hard blocker
- Useful human + bot threads handled (or declined with policy)
- Branch not conflicted / not wrongly behind (when claiming ready)
- CLI + required CI green (when claiming ready)
- PR(s) **not** merged
