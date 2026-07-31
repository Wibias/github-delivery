# Research issue(s)

**Trigger:** “Research issue #N”, “research issues #A #B”, “is #N still an issue on latest dev?”, “triage/research this issue”.

## Goal

On the **latest development branch tip**, determine for each issue: what it really is, whether it still reproduces / needs work, whether it’s already fixed on that branch, whether an open (or merged) PR already covers it, whether a duplicate issue exists, **security relevance** (`none` / `possible` / `likely`), and a **priority** (`low` / `middle` / `high`) with short obvious reasons. Then **post a research review comment on each issue**.

Do **not** open a PR unless the user also asked to create one.

## Differs from

| Skill | Owns |
|---|---|
| **shipping-github / this workflow** | Codebase + GitHub evidence, still-broken-on-dev?, open PR?, duplicate?, priority, **comment on the issue** |
| **issue-workflow** | Filing/breaking down tracker artifacts (PRDs, slices) — not live “is it fixed on tip?” research |

## Inputs

- One or many issue numbers (`#12`, `#12 #34`, “issues 12 and 34”).
- Default research head: repo’s **development branch** (often `dev` / `develop` / default trunk — detect; fetch latest). Do not assume `main` is “most up to date” if a dedicated development branch exists.

## Per-issue checklist

Run for **each** issue (batch in parallel when independent). If **>3** issues: fan out with **subagents** (shared **Multi-PR / multi-issue fan-out**) — one issue per subagent; parent aggregates the chat table.

1. **Fetch** — title, body, labels, state, author, assignees, linked PRs, timeline.
2. **Restate the claim** — one sentence: what exact bug/feature/ask is this? Separate reporter’s theory from observable symptom.
3. **Latest-dev check** — update/fetch the development branch tip. Search code + history for the behavior. Prefer a minimal repro/test on that tip when feasible; if not tested, say so and why.
4. **Already fixed on development?** — cite commit SHA / merged PR if yes. Note if fixed on development but **not** on release/default. If so: follow shared **Backport / release branch** (ask once before opening a backport PR).
5. **Existing PR?** — `gh pr list --search` / issue timeline for open or recently merged PRs that fix or reference it. If open PR exists: link it; do not propose a second PR.
6. **Duplicate / same issue?** — search open+closed issues by keywords/symptoms. If duplicate: link the canonical issue (prefer older or clearly maintained). Don’t claim duplicate without a link.
7. **Security relevance** — classify from title, body, labels, and what the code path touches (not from vibes alone):

| Level | When |
|---|---|
| **none** | No credible auth/secrets/injection/access-control/crypto/privacy angle |
| **possible** | Touches API, auth-adjacent UI, permissions, tokens, user data, or security labels — impact unclear without deeper review |
| **likely** | Clear vuln class (XSS, SQLi, auth bypass, secret exposure, RCE, privilege escalation, etc.) or reporter frames a security bug |

   - If **possible** or **likely**: note a **high-level** threat class only in public text (e.g. “authz”, “token handling”) — never steps to abuse. Treat **likely** as a default **high** priority signal unless clearly fixed/shipped.
   - **Ask the user once** in chat (per batch is fine), using this shape:

     > Security relevance **possible/likely** on #<ids>. Want me to run a security review on these issues and **post** a review comment on each? (Exploit/abuse details stay in chat only — public posts are redacted.)

     Do **not** auto-run. If they say yes → `references/security-review.md` with issue targets + post redacted public comments (shared disclosure rules).
8. **Priority** — pick one; reasons must be obvious from impact, not taste:

| Priority | Typical signals |
|---|---|
| **high** | Crash, data loss, **likely security**, broken primary path, clear regression, blocks release |
| **middle** | Real bug with workaround, moderate user impact, incomplete feature users expect, **possible** security without confirmed exploitability |
| **low** | Polish, rare edge case, unclear/unrepro, pure enhancement, docs nit, security relevance **none** |

9. **Verdict** — one of:

| Verdict | Meaning |
|---|---|
| Needs fix on development | Still present / unimplemented on latest development tip |
| Fixed on development, not released | On development tip only; missing from release/default |
| Already fixed / shipped | On release/default or closed with the fix landed |
| Covered by open PR | Work in progress — cite PR |
| Duplicate | Same as another issue — cite canonical |
| Not actionable / not a bug | Misconfig, upstream, insufficient info — say what is missing |

## Comment on the issue (required)

Post on **each** researched issue (prefix agent research comments with `[shipping-github]`):

```markdown
## [shipping-github] Research review

**Claim:** <one sentence>
**Checked against:** <development-branch>@<short-sha> (and release/default if relevant)

| Field | Finding |
|---|---|
| Still an issue on latest development? | yes / no / unclear |
| Exact issue | … |
| Fixed on development? | no / yes — <PR/SHA> |
| Open PR covering this? | none / #<n> |
| Duplicate of? | none / #<n> |
| Security relevance | **none \| possible \| likely** — <high-level class only, e.g. authz / tokens — no exploit steps> |
| Priority | **low \| middle \| high** — <1–2 obvious reasons> |
| Verdict | <from table> |

**Evidence:** <links, SHAs, brief repro notes>
**Gaps:** <what wasn’t verified, if any>
```

Also summarize the same table(s) to the user in chat. For multiple issues, one chat summary with a row per issue, plus per-issue GitHub comments (**one research comment per issue** — edit if updating; never post a truncated stub then a full second comment).

When any issue is **possible** or **likely** security: ask in chat with the wording above (review + post, redacted public / full detail in chat). Do not auto-start.

When verdict is **Fixed on development, not released**: ask the backport question (shared rules). Do not open a backport unless they say yes.

When the real need is a **PRD / vertical-slice breakdown** rather than tip research: say so and hand off to `issue-workflow`.

Research may batch **comments**; it must **not** open PRs. Opening PRs is `create-pr-for-issue` only, one at a time unless the user explicitly demands a batch (including backports).

## Done when

- Every requested issue has verdict + priority + **security relevance** + evidence
- Each has a research comment on GitHub
- Security-review ask made when relevance is possible/likely
- No PR opened unless also requested
- No security review started unless the user said yes