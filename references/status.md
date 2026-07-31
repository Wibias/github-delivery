# Status / what’s left

**Trigger:** “status on pr #N”, “what’s left on pr #N”, “is it merge ready?”, read-only check.

## Goal

Report merge readiness **using the same bar as merge-ready / full-review** — without changing code, pushing, merging, or resolving threads. Read-only unless the user then asks to fix.

## Steps

1. Load PR `#N` with the **Final evidence sweep** inputs from `shared-rules.md` (read-only — do not update base or push):
   - draft/WIP/do-not-merge gates
   - behind-base / conflicts / `mergeStateStatus`
   - head SHA + whether it is tip-fresh (note if behind — do **not** claim merge-ready)
   - required checks via `scripts/required-checks.mjs` when possible (else `gh pr checks` + protection/rulesets)
   - review policy via `scripts/pr-policy-gate.mjs` (code-owner **enforcement**, dismiss-stale, last-push, merge queue)
   - unresolved threads via `scripts/review-threads.mjs`
   - `reviewDecision`, CODEOWNERS / pending required reviewers (`scripts/codeowners-for-pr.mjs` when possible)
   - fork head / `isCrossRepository` (can maintainers push?)
   - stacked? (base is another open PR head)
   - merge-queue queued vs merged
   - linked issues; security/API cue; changelog gap if user-facing
   - whether this session already ran own bug+security+spec (if unknown: say **unknown — not run this session**; do **not** invent “own reviews done”)

2. Emit using the **Status** template in `references/comment-depth.md` (gate table + “What’s left” with concrete actions). Include the same fields as below at minimum — expand with evidence (job names, SHAs, thread counts):

```markdown
## [shipping-github] Status

**Verdict:** not merge-ready / merge-ready bar met (not posted) / gated
**Head:** `<sha>` → `<base>` (`mergeStateStatus`)

| Gate | State | Detail |
|---|---|---|
| Owner/human threads | … | … |
| Bot threads | … | … |
| Own reviews | done / missing / unknown | … |
| Tip / conflicts | … | … |
| Required CI | … | name jobs |
| Policy (CODEOWNERS/approvals/queue) | … | … |

**What’s left:** <ordered concrete actions>
```

Do **not** post a vague “CI mostly green, some comments” summary.
3. **Verdict rules (same as merge-ready — stricter than “CI green”):**
   - `merge-ready` only if gate clear, up to date (or you positively know tip compiles), required CI green on current SHA, reviews/CODEOWNERS clear, useful bot/human threads clear, not mid-stack-for-trunk, and own bug+security done **or** you explicitly say status cannot confirm own reviews and therefore verdict is **blocked / incomplete** — never “merge-ready” when own reviews are unknown.
   - Prefer **blocked** when read-only status cannot verify compile-against-tip or own reviews.

4. If security/API cue and not yet asked this session: ask whether to run security review (do not run until yes).
5. If draft/WIP and user asked about merge-ready: remind **Draft → ready** ask (do not convert in status — status is read-only).
6. If stacked: point at `manage-stacked-prs` for trunk merge order.
7. Stop. Do not fix unless they ask.

## Done when

- Status checklist posted to the user with a verdict that cannot be looser than merge-ready rules
- No mutations performed
