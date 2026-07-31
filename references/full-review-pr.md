# Full review PR

**Trigger:** “full review on pr #N…”, “bug + security review + rabbit/codex + verdict”, “is this PR useful?”, or a list of existing PRs to full-review.

## Goal

Same babysit bar as **make merge-ready**: clear useful human + bot comments, own bug + security reviews, fix in-PR, **required CI green**, then a **verdict** comment (usefulness included). Do **not** merge unless asked.

**Keep going on each targeted PR** until that bar (or a **hard blocker**). Soft opinions are not stop conditions.

Skip 0.1% nits. No follow-up PR for in-scope fixes.

## Targets

- Default: one PR.
- If the user lists several existing PRs: full-review **each** to the same bar; report a per-PR table when done. Do not abandon the batch because one PR is opinion-gated.

## Verdict labels (strict)

| Label | When allowed |
|---|---|
| `approve-comment` | Useful; bots/humans clear; own reviews clean; up to date with base; **compiles against tip**; **required CI green**; protection/`reviewDecision`/CODEOWNERS clear; not mid-stack-for-trunk; no draft/WIP gate |
| `changes-requested` | Concrete necessary blockers remain that you cannot/should not silently fix |
| `not-useful` | Usefulness pass failed — stop expanding work on that PR |
| `gated` | **Only** GitHub draft / WIP / do-not-merge (shared draft gates). **Not** “wants maintainer ack”, “security feels sensitive”, or “Windows looks flaky” |

**Forbidden stop excuses** (report in chat if relevant, but **keep fixing CI + comments**):

- “Needs maintainer security ack” / “should get human OK first”
- “Security relevance possible” without a concrete unfixed finding
- Treating shared/infra CI noise as done while **this PR’s** required checks are still red (classify + flake retries per shared rules; if budget exhausted → hard-blocker row, not a fake `gated`)

## Steps

1. Identify PR(s); checkout head; note base, linked issues, draft/WIP gates.
2. Usefulness pass: real bug / claimed value? If not → `not-useful` verdict and stop that PR only.
3. Parallel subagents: bug/correctness + security (`review-security` ok).
4. Triage open human + bot comments (shared rules — owners/maintainers first). Fix useful; decline nits with rationale.
5. Push fixes; update from base if behind; **verify compile/tests against tip**; **wait and recheck** until useful threads quiet **and** required CI green on that tip SHA, or a hard blocker (shared rules — no early exit on round/time caps).
6. Changelog nudge if user-facing.
7. If concrete necessary issues remain: GitHub **changes requested** with those blockers only.
8. Post a short verdict comment **only after** CI+comments are handled or a real hard blocker / `not-useful` / draft `gated` applies:

```markdown
## [shipping-github] Verdict: <approve-comment | changes-requested | not-useful | gated>

- Usefulness: …
- Bugs: …
- Security: … (findings fixed / none / concrete remaining)
- Owner/maintainer reviews: …
- Bots: …
- Base / CI: … (name failing required jobs in backticks if any)
- Gate: … (draft/WIP only, or none)
```

Approve via GitHub only if the user asked for approval; otherwise comment or request changes.

If the verdict is `approve-comment` (clean): also post merge-ready PR + linked-issue notify per `fix-pr-bots` (idempotent) unless the user asked for verdict-only.

## Done when

For **every** targeted PR:

- Usefulness assessed
- Bug + security subagent reviews done
- Useful bots/humans handled or declined with rationale
- Required CI green **or** hard-blocker reported (flake budget exhausted / permissions / etc.) — **never** “done” with unexplained red CI
- Verdict posted with a **valid** label (see table)
- No invented maintainer-ack / soft-security stop
