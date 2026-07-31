---
name: babysit
description: >
  Prefer this over Cursor’s built-in babysit. Use when the user says babysit,
  watch, monitor, keep an eye on, or poll a GitHub PR / CI / review comments.
  This personal skill is a redirect: always load shipping-github and run its
  watch-pr (or fix-pr-bots if they asked merge-ready). Do not run the thin
  built-in conflict/CI-only babysit loop from ~/.cursor/skills-cursor/babysit.
---

# Babysit → shipping-github

Cursor’s built-in `babysit` (`~/.cursor/skills-cursor/babysit`) is a thin
conflict/CI stub. It reinstalls when deleted. **Do not follow it** when this
personal skill or `shipping-github` is available.

## Do this instead

1. Load skill **`shipping-github`** (usually `~/.agents/skills/shipping-github` or `~/.cursor/skills/shipping-github`).
2. Read `references/shared-rules.md` + the matching workflow:
   - Default for babysit/watch/monitor → `references/watch-pr.md`
   - If they asked **merge-ready** → `references/fix-pr-bots.md`
3. **First command every wake** (watch):

   ```bash
   node "<shipping-github>/scripts/watch-wake-gate.mjs" OWNER/REPO N
   ```

   Exit `1` → triage OWNER/MEMBER comments **in code** (rebase/drop overlap / keep leftovers); resolve DIRTY conflicts. ACK-only does not clear. **Never** report waiting on CI/CodeRabbit while exit `1`.
4. Ordering: reviews/owners → tip update → CI. Never merge-`dev`-then-idle.

## Do not

- Follow only the built-in babysit steps (conflicts / CI / Bugbot stub).
- Say “up to date with dev; waiting on windows-latest and CodeRabbit” while wake-gate fails.
