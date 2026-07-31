# Status / what’s left

**Trigger:** “status on pr #N”, “what’s left on pr #N”, “is it merge ready?”, read-only check.

## Goal

Report merge readiness **using the same bar as merge-ready / full-review** — without changing code, pushing, merging, or resolving threads. Read-only unless the user then asks to fix.

## Steps

1. Load PR `#N` with the **Final evidence sweep** inputs from `shared-rules.md` (read-only — do not update base or push):
   - draft/WIP/do-not-merge gates
   - behind-base / conflicts / `mergeStateStatus`
   - head SHA + whether it is tip-fresh (note if behind — do **not** claim merge-ready)
   - required checks via `gh pr checks` + protection best-effort (shared **Required checks + review gate**)
   - `reviewDecision`, CODEOWNERS / pending required reviewers
   - unresolved published human (owners first) + bot threads; flag rate-limited bot “SUCCESS” with open threads
   - fork head / `isCrossRepository` (can maintainers push?)
   - stacked? (base is another open PR head)
   - linked issues; security/API cue; changelog gap if user-facing
   - whether this session already ran own bug+security (if unknown: say **unknown — not run this session**; do **not** invent “own reviews done”)

2. Emit:

```markdown
## PR #N status

- Gate: draft/WIP/do-not-merge — clear | blocked (<reason>)
- Base: up to date with tip | behind | conflicts
- Compile-against-tip: verified this session | unknown (read-only; behind or not checked)
- Required CI (this SHA): green | red/pending (`job…`)
- Branch protection / reviewDecision: clear | blocked (`CHANGES_REQUESTED` / REVIEW_REQUIRED / …)
- CODEOWNERS / required reviewers: clear | pending (<who>)
- Owner/maintainer threads: none open | N open
- Other human threads: none open | N open
- Bots (CodeRabbit/Codex): none open | N open | rate-limited summary only (threads still open?)
- Own bug+security (this session): done | not run | unknown
- Fork head / push: same-repo | fork (maintainerCanModify yes/no)
- Stack: standalone | stacked on PR #P (not trunk-ready)
- Security offer: n/a | cue present (not run) | already run/declined
- Changelog nudge: n/a | user-facing, no entry
- Linked issues: …

Verdict: merge-ready | blocked — <one line matching fix-pr-bots bar>
```

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
