# Fix PR bots → merge-ready

**Trigger:** “review my pr #N - fix coderabbit/codex…”, “make PR #N merge ready”, bot-fix loops.

## Goal

Necessary/useful **human** (esp. owners/maintainers) + CodeRabbit/Codex comments addressed, branch not behind/conflicted, CLI + required CI green, then a merge-ready summary — unless a draft/WIP/do-not-merge gate blocks it. Do **not** merge.

## Steps

1. Identify PR `#N`, checkout head branch, note base/default branch.
2. Apply **draft/WIP/do-not-merge** awareness (shared rules). Work may continue; do not claim final merge-ready while gated.
3. **Behind base + conflicts:** update from base if needed; resolve or stop and ask.
4. Collect unresolved review threads: owners/maintainers first, then other humans, then bots. Skip resolved/outdated.
5. Triage and fix necessary/useful items (trusted humans first; verify bots). For human declines needing a written reply: confirm exact text in chat first (shared social policy). Bot skip notes may use `[shipping-github]` prefix.
6. Push fixes (git safety: no force-push; stop if rejected / dirty unrelated tree).
7. **Wait** under **fix-mode caps** (3 rounds / 20 min). If new useful comments appear, fix and push again until stable or cap.
8. Fix CLI / project checks this PR broke. Classify CI: branch fix vs flake (shared rules).
9. Recheck reviews + required CI. If new useful comments or red required CI, return to step 4/8 within caps.
10. Security-offer + changelog nudge when applicable.
11. **Final evidence sweep** (shared rules). If gates clear and checks green, post:

```markdown
## Merge ready

- Human review (trusted/owners first): addressed / declined (chat-confirmed if human reply)
- Bot review (CodeRabbit/Codex): addressed / declined with rationale
- Base: up to date / conflicts resolved
- CLI / local checks: green
- Required CI: green (flaky retries used: N)

Ready to merge.
```

If still draft/WIP/do-not-merge: post status of fixes but **say merge is blocked by \<gate\>**.

For continuous monitoring after green, hand off to `watch-pr` if the user wants babysitting.

## Done when

- Useful human + bot threads handled (or caps reported)
- Branch not conflicted / not wrongly behind
- CLI + required CI green
- Merge-ready comment posted **or** gated status explained
- PR **not** merged
