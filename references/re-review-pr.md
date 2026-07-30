# Re-review PR

**Trigger:** “re-review pr #N based on my review comment + his commits + new rabbit & Codex…”

## Goal

Re-evaluate the PR from the user’s review comment(s), the author’s subsequent commits, and new CodeRabbit/Codex comments. Fix what can/should be fixed in this PR. Request changes on GitHub when real issues remain. No follow-up PRs for fixable items. Skip 0.1% nits.

## Steps

1. Load PR `#N`: description, user/owner/maintainer review comments, other human reviews, new commits since that review, unresolved bot comments. Note draft/WIP gates and behind-base/conflicts.
2. Diff the new commits against the concerns raised.
3. Triage **humans first (owners/maintainers priority), then bots** (shared rules): fix useful; skip nits with rationale.
4. If behind/conflicted: update from base before pushing further fixes.
5. If changes are needed and you can fix them here: implement, push, wait and recheck until stable or a hard blocker (shared rules — no early exit on round/time caps).
6. If real necessary issues remain that you cannot or should not silently rewrite: submit a GitHub **changes requested** review with concrete blockers only.
7. Do not auto-reply on human threads without exact-text confirmation (shared social policy).
8. Security-offer + changelog nudge when applicable.
9. If clean enough: say so in a short review comment (approve only if the user asked to approve; otherwise comment or request-changes as appropriate). Do not claim merge-ready while draft/WIP/do-not-merge. Final evidence sweep before any ready claim.

## Done when

- Human + bot concerns re-checked against latest commits
- Fixable issues landed in this PR (or explicitly declined)
- Changes requested only for real remaining blockers
- No drive-by follow-up PR created for in-scope fixes
