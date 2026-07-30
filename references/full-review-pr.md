# Full review PR

**Trigger:** “full review on pr #N…”, “bug + security review + rabbit/codex + verdict”.

## Goal

Decide if the PR is useful (bugfix / meaningful change), run bug + security review, clear open useful bot comments, fix what should be fixed here, and leave a verdict comment. Use subagents. Request changes for real remaining blockers. Skip 0.1% nits. No follow-up PR for in-scope fixes. Do **not** merge unless asked.

## Steps

1. Load PR `#N`: intent, diff, linked issue, draft/WIP gates, behind-base/conflicts, required CI, unresolved **human** (owners/maintainers first) + CodeRabbit/Codex comments.
2. Usefulness pass: is it fixing a real bug / delivering the claimed value? If not useful, verdict = reject/close recommendation and stop expanding work.
3. Launch **parallel subagents**:
   - Bug / correctness review
   - Security review (`review-security` helper ok)
4. Triage open human + bot comments (shared rules — owners/maintainers first).
5. Fix everything that can and should be fixed in this PR; update from base if behind; push; wait (caps); recheck.
6. Changelog nudge if user-facing.
7. If real necessary issues remain: GitHub **changes requested** with concrete blockers only.
8. Post a short verdict comment:

```markdown
## Verdict: <approve-comment | changes-requested | not-useful | gated>

- Usefulness: …
- Bugs: …
- Security: …
- Owner/maintainer reviews: …
- Bots: …
- Base / CI: …
- Gate: …
```

Approve via GitHub only if the user asked for approval; otherwise comment or request changes.

## Done when

- Usefulness assessed
- Bug + security subagent reviews done
- Useful bots/fixes handled or declined with rationale
- Verdict comment posted
- Changes requested only when warranted
