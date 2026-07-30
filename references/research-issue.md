# Research issue(s)

**Trigger:** “Research issue #N”, “research issues #A #B”, “is #N still an issue on latest dev?”, “triage/research this issue”.

## Goal

On the **latest development branch tip**, determine for each issue: what it really is, whether it still reproduces / needs work, whether it’s already fixed on that branch, whether an open (or merged) PR already covers it, whether a duplicate issue exists, and a **priority** (`low` / `middle` / `high`) with short obvious reasons. Then **post a research review comment on each issue**.

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

Run for **each** issue (batch in parallel when independent):

1. **Fetch** — title, body, labels, state, author, assignees, linked PRs, timeline.
2. **Restate the claim** — one sentence: what exact bug/feature/ask is this? Separate reporter’s theory from observable symptom.
3. **Latest-dev check** — update/fetch the development branch tip. Search code + history for the behavior. Prefer a minimal repro/test on that tip when feasible; if not tested, say so and why.
4. **Already fixed on development?** — cite commit SHA / merged PR if yes. Note if fixed on development but **not** on release/default.
5. **Existing PR?** — `gh pr list --search` / issue timeline for open or recently merged PRs that fix or reference it. If open PR exists: link it; do not propose a second PR.
6. **Duplicate / same issue?** — search open+closed issues by keywords/symptoms. If duplicate: link the canonical issue (prefer older or clearly maintained). Don’t claim duplicate without a link.
7. **Priority** — pick one; reasons must be obvious from impact, not taste:

| Priority | Typical signals |
|---|---|
| **high** | Crash, data loss, security, broken primary path, clear regression, blocks release |
| **middle** | Real bug with workaround, moderate user impact, incomplete feature users expect |
| **low** | Polish, rare edge case, unclear/unrepro, pure enhancement, docs nit |

8. **Verdict** — one of:

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
| Priority | **low \| middle \| high** — <1–2 obvious reasons> |
| Verdict | <from table> |

**Evidence:** <links, SHAs, brief repro notes>
**Gaps:** <what wasn’t verified, if any>
```

Also summarize the same table(s) to the user in chat. For multiple issues, one chat summary with a row per issue, plus per-issue GitHub comments.

## Done when

- Every requested issue has verdict + priority + evidence
- Each has a research comment on GitHub
- No PR opened unless also requested
