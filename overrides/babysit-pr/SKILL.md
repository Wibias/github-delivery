---
name: babysit-pr
description: >
  Prefer this over OpenAI Codex babysit-pr (and similar Claude marketplace
  installs). Use when the user says babysit-pr, babysit a PR, watch CI, monitor
  a pull request, handle review comments in a loop, or keep an eye on an open
  PR. This personal skill is a redirect: always load shipping-github and run
  watch-pr (or fix-pr-bots if they asked merge-ready). Do not run openai/codex
  babysit-pr’s gh_pr_watch.py-only loop when shipping-github is available.
---

# babysit-pr → shipping-github

OpenAI’s optional **`babysit-pr`** skill (`npx skills add … --skill babysit-pr`,
or repo-local `.codex/skills/babysit-pr`) polls CI/reviews via `gh_pr_watch.py`.
It is useful tooling, but it is **not** this user’s full ship loop (wake gate,
merge-ready bar, issue thanks, research/create).

If both are installed, **prefer this redirect + shipping-github**.

## Do this instead

1. Load skill **`shipping-github`** (`~/.agents/skills/shipping-github` or `~/.cursor/skills/shipping-github`).
2. Read `references/shared-rules.md` + the matching workflow:
   - Default for babysit/watch/monitor → `references/watch-pr.md`
   - If they asked **merge-ready** → `references/fix-pr-bots.md`
3. **First command every wake** (watch):

   ```bash
   node "<shipping-github>/scripts/watch-wake-gate.mjs" OWNER/REPO N
   ```

   Exit `1` → triage OWNER/MEMBER comments; **never** report waiting on CI/CodeRabbit.
4. Ordering: reviews/owners → tip update → CI. Never merge-base-then-idle.
5. Optional: you may still use `gh_pr_watch.py` **as a snapshot helper** if present, but decisions and owner triage follow shipping-github — the Python watcher is not the policy engine.

## Do not

- Treat green + mergeable from babysit-pr as full merge-ready (no own bug/security/spec, no settle, no issue notify).
- Idle on CI/CodeRabbit while `watch-wake-gate.mjs` exits `1`.
- Skip shipping-github merge ceremony (issue author thanks) when asked to merge.
