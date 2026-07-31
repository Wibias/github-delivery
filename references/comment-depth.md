# Comment depth (public GitHub posts)

Load with any workflow that posts research, security, verdict, merge-ready, status, or re-review comments.

Vague posts are a bug. Prefer **structured detail** over one-liners — still scannable, not essays.

## Depth rules

1. **Name concrete things** in backticks: files, symbols, checks, SHAs, PR/issue numbers, branches.
2. **Say what you checked** (paths, tip SHA, tests/commands) and **what you concluded** — not “looks fine.”
3. **Separate facts from judgment:** evidence → finding → action (fixed / declined / follow-up).
4. **Per-axis completeness:** if a template has a section, fill it (use `none` / `n/a` with why when empty).
5. **Security public posts stay redacted** (shared disclosure) — detail ≠ exploit steps.
6. **Idempotent:** edit the prior `[shipping-github]` comment of the same intent; don’t spam a second vague stub.
7. **Chat can be fuller** than GitHub for security abuse paths and long dumps.

Anti-patterns (rewrite before posting):

- “Bots addressed / CI green / looks good”
- “Security: none” with no scope of what was reviewed
- “Fixed on development” without SHA/PR
- Merge-ready checklist with only yes/no and no evidence lines

## Research (issue)

```markdown
## [shipping-github] Research review

**Claim:** <what the reporter asserts, in one precise sentence>
**Checked against:** `<dev-branch>@<short-sha>` (release/default: `<branch>@<sha or n/a>`)

| Field | Finding |
|---|---|
| Still an issue on latest development? | yes / no / unclear |
| Exact issue | <symptom + where in code/product; cite `path` / command> |
| Fixed on development? | no / yes — `<PR#>` / `<sha>` — <one line what landed> |
| Open PR covering this? | none / `#<n>` (`title`, author, status) |
| Duplicate of? | none / `#<n>` — why same root cause |
| Security relevance | **none \| possible \| likely** — <class only: authz / tokens / SSRF / …> |
| Priority | **low \| middle \| high** — <impact + who hits it + how often> |
| Verdict | <Needs fix on development \| Fixed on development, not released \| Already fixed / shipped \| Covered by open PR \| Duplicate \| Not actionable / not a bug> |

**Evidence**
- Tip check: <command or file read + result in one line each>
- History: <related PRs/issues/commits if any>
- Repro: <done / not attempted — why>

**Gaps:** <what was not verified>

**Recommended next:** <fix on tip / close as shipped / wait on PR #n / ask reporter for X>
```

## Security (issue or PR — public / redacted)

```markdown
## [shipping-github] Security review

**Target:** issue `#N` / PR `#N` (`head@<sha>` or `dev@<sha>`)
**Scope:** <components / routes / auth surfaces reviewed>
**Method:** <subagent / manual paths / scanners used as leads>

| Severity | Area | Finding (redacted) | Next |
|---|---|---|---|
| critical\|high\|medium\|low\|info | <authz / tokens / …> | <what is wrong + affected surface — no exploit steps> | <fix in PR #n / patch tip / accept risk / needs maintainer> |

**Summary:** <2–4 sentences: overall risk, whether tip is exploitable vs design gap>
**Residual / out of scope:** <what you did not cover>
**Fixes landed this session:** none / <sha + one line> (PR reviews only)
```

If too sensitive for a useful public table, use the short “details shared privately” form in `security-review.md`, and put the full table in **chat**.

## Full-review / re-review verdict (PR)

```markdown
## [shipping-github] Verdict: <approve-comment | changes-requested | not-useful | gated>

**PR:** `#N` — <title>
**Head:** `<short-sha>` on `<base>` (mergeStateStatus: `…`)
**Linked:** `#…` / none

### Usefulness
<Does it fix a real bug / deliver claimed value? Cite issue + user-visible effect.>

### Bugs / correctness
- Checked: <areas / tests run>
- Findings: none blocking / <list with `path` + why it matters>
- Fixed this session: none / <sha + summary>

### Security
- Scope reviewed: <auth / input / …>
- Findings: none / <redacted one-liners>
- Fixed this session: none / <sha>

### Spec / standards
- Spec source: linked issue / PR body / none
- Gaps: none / <what drifts from claimed behavior or repo norms>

### Reviews
- Owners/maintainers: none open / addressed <threads> / pending <who>
- Bots (CodeRabbit/Codex/Bugbot): cleared / declined <nit> with rationale / open <id>

### Base / CI
- Behind/conflicts: clean / updated in `<sha>` / **DIRTY** (blocker)
- Required checks: green / failing `job-name` (branch vs flake)
- Local tip compile/tests: <command + result>

### Gate
none / draft|WIP|do-not-merge / hard blocker: <…>

### Bottom line
<One paragraph: ship / fix these N items / not useful because …>
```

## Merge-ready (PR)

```markdown
## [shipping-github] Merge ready

**PR:** `#N` — <title>  
**Head:** `<short-sha>` → `<base>` (`mergeStateStatus: CLEAN`)  
**Linked issues:** `#…`

### Reviews
- **Humans (owners first):** <what was raised → fixed in `sha` / declined because … / none>
- **Bots:** <0 unresolved useful threads; notable declines with one-line rationale>
- **Own bug + security + spec/standards:** done on tip; blockers fixed: <none / list>

### Tip freshness
- Updated from `<base>`: yes (`sha`) / already current
- Compiles/tests against tip: <command + pass>
- Conflicts: none

### Checks
- Local/CLI: <what ran + green>
- Required CI: green on `<sha>` (flake retries: N — `job` if any)
- Policy: code-owner enforcement / stale approvals / merge-queue: clear / n/a

### Residual
none / follow-ups explicitly out of scope: <…>

Ready to merge.
```

## Merge-ready notify (linked issue)

```markdown
## [shipping-github] PR merge-ready

PR `#<pr>` (`<short title>`) is merge-ready on `<base>@<sha>`:
- Reviews (humans + bots) + own bug/security/spec: clean
- Required CI green; tip compiles

Not merged yet — waiting on merge when you want it.
```

## Status (PR)

Same evidence depth as merge-ready, labeled **Status** (not Merge ready). Each blocker gets a concrete next action.

```markdown
## [shipping-github] Status

**Verdict:** not merge-ready / merge-ready bar met (not posted) / gated
**Head:** `<sha>` → `<base>` (`mergeStateStatus`)

| Gate | State | Detail |
|---|---|---|
| Owner/human threads | … | … |
| Bot threads | … | … |
| Own reviews | done / missing | … |
| Tip / conflicts | … | … |
| Required CI | … | name jobs |
| Policy (CODEOWNERS/approvals/queue) | … | … |
| Settle | n/a for status | — |

**What’s left:** <ordered list of concrete actions>
```

## Merge thanks (PR + issue)

Still short, but concrete:

**PR (other author):**

```markdown
Thanks @{author} — merging this.

Why it helps: <2–3 sentences: user-visible bug/value, key change in `path`/behavior, linked `#issue` if any>

Ship it.
```

**Issue (after merge):**

```markdown
Thanks @{issue_author} — fixed by PR `#<n>` (`<short-sha>`): <what changed for users / which failure mode is gone>.
```
