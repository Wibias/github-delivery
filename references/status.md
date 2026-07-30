# Status / what’s left

**Trigger:** “status on pr #N”, “what’s left on pr #N”, “is it merge ready?”, read-only check.

## Goal

Report merge readiness without changing code, pushing, merging, or resolving threads. Read-only unless the user then asks to fix.

## Steps

1. Load PR `#N`: draft/labels/title, mergeable + behind-base, required CI, unresolved human reviews (flag owners/maintainers), unresolved bots, linked issues, security/API cues, changelog gap if user-facing.
2. Emit a short checklist:

```markdown
## PR #N status

- Gate: draft/WIP/do-not-merge — clear | blocked (<reason>)
- Base: up to date | behind | conflicts
- Required CI: green | red (<checks>)
- Owner/maintainer reviews: none open | N open
- Other human reviews: none open | N open
- Bots (CodeRabbit/Codex): none open | N open
- Security offer: n/a | cue present (not run) | already run/declined
- Changelog nudge: n/a | user-facing, no entry
- Linked issues: …

Verdict: merge-ready | blocked — <one line>
```

3. If security/API cue and not yet asked this session: ask whether to run security review (do not run until yes).
4. Stop. Do not fix unless they ask.

## Done when

- Status checklist posted to the user
- No mutations performed
