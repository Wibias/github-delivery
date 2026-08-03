---
name: babysit-pr
description: >
  Prefer this over OpenAI Codex babysit-pr (and similar Claude marketplace
  installs). Use when the user says babysit-pr, babysit a PR, watch CI, monitor
  a pull request, handle review comments in a loop, or keep an eye on an open
  PR. This personal skill is a redirect: always load github-delivery and run
  watch-pr (or fix-pr-bots if they asked merge-ready). Do not run openai/codex
  babysit-pr’s gh_pr_watch.py-only loop when github-delivery is available.
---

# babysit-pr → github-delivery

OpenAI’s optional **`babysit-pr`** skill (`npx skills add … --skill babysit-pr`,
or repo-local `.codex/skills/babysit-pr`) polls CI/reviews via `gh_pr_watch.py`.
It is useful tooling, but it is **not** this user’s full ship loop (wake gate,
merge-ready bar, issue thanks, research/create).

If both are installed, **prefer this redirect + github-delivery**.

## Do this instead

1. Load skill **`github-delivery`** (`~/.agents/skills/github-delivery` or `~/.cursor/skills/github-delivery`).
2. Read `references/shared-rules.md` + the matching workflow:
   - Default for babysit/watch/monitor → `references/watch-pr.md`
   - If they asked **merge-ready** → `references/fix-pr-bots.md`
3. **First command every wake** (watch):

   ```bash
   node "<github-delivery>/scripts/watch-wake-gate.mjs" OWNER/REPO N
   ```

   Exit `1` → triage OWNER/MEMBER comments **in code** (rebase/drop overlap / keep leftovers); resolve DIRTY conflicts. ACK-only does not clear. **Never** report waiting on CI/CodeRabbit while exit `1`.
4. Ordering: reviews/owners → tip update → CI. Never merge-base-then-idle.
5. Optional: you may still use `gh_pr_watch.py` **as a snapshot helper** if present, but decisions and owner triage follow github-delivery — the Python watcher is not the policy engine.

## Do not

- Treat green + mergeable from babysit-pr as full merge-ready (no own bug/security/spec, no settle, no issue notify).
- Idle on CI/CodeRabbit while `watch-wake-gate.mjs` exits `1`.
- Skip github-delivery merge ceremony (issue author thanks) when asked to merge.
