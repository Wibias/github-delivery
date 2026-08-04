# Comment depth (public GitHub posts)

Load with any workflow that posts research, security, verdict, merge-ready, status, or re-review comments.

Vague posts are a bug. Prefer **structured detail** over one-liners — still scannable, not essays.

## Depth rules

1. **Name concrete things** in backticks: files, symbols, checks, SHAs, PR/issue numbers, branches.
2. **GitHub `@mentions` stay bare** — write `@user`, never `` `@user` ``. Backticks kill the mention (no notify, looks like code). Same for merge thanks / verdict / any public comment.
3. **Say what you checked** (paths, tip SHA, tests/commands) and **what you concluded** — not “looks fine.”
4. **Separate facts from judgment:** evidence → finding → action (fixed / declined / follow-up).
5. **Per-axis completeness:** if a template has a section, fill it (use `none` / `n/a` with why when empty).
6. **Security public posts stay redacted** (shared disclosure) — detail ≠ exploit steps.
7. **Idempotent within one publication identity:** repair or complete the current run’s own comment instead of duplicating it. A new explicit full-review invocation is a new publication identity and MUST post a new verdict comment; never overwrite a completed verdict from an earlier full-review run.
8. **Chat can be fuller** than GitHub for security abuse paths and long dumps.
9. **Full-review verdicts:** lead with a **TLDR** that carries the decision, every axis outcome, blockers, owner actions, and bottom line; put the complete verdict in a `<details>` dropdown. The TLDR never drops a blocker, owner action, or required next step. `scripts/verify-verdict-published.mjs` enforces this structure (strict `[GD] Verdict:` label, `### TLDR` with every bullet below, `<details>` dropdown after the TLDR); a verdict that fails the format gate is an incomplete publication and must be repaired before `Publish final verdict` completes.

Anti-patterns (rewrite before posting):

- “Bots addressed / CI green / looks good”
- “Security: none” with no decision/risk line
- Security comments that dump `requiredSurfaces=[…]`, method essays, or a findings table whose only row is “none” in every column
- “Fixed on development” without SHA/PR
- Merge-ready checklist with only yes/no and no evidence lines
- Backticked people: `` `@login` `` / `` `@{author}` `` (must be bare `@login`)

## Research (issue)

```markdown
## [GD] Research review

**Claim:** <what the reporter asserts, in one precise sentence>
**Checked against:** `<dev-branch>@<short-sha>` (release/default: `<branch>@<sha or n/a>`)

| Field                                 | Finding                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Still an issue on latest development? | yes / no / unclear                                                                                                                                           |
| Exact issue                           | <symptom + where in code/product; cite `path` / command>                                                                                                     |
| Fixed on development?                 | no / yes — `<PR#>` / `<sha>` — <one line what landed>                                                                                                        |
| Open PR covering this?                | none / `#<n>` (`title`, author, status)                                                                                                                      |
| Duplicate of?                         | none / `#<n>` — why same root cause                                                                                                                          |
| Security relevance                    | **none \| possible \| likely** — <class only: authz / tokens / SSRF / …>                                                                                     |
| Priority                              | **low \| middle \| high** — <impact + who hits it + how often>                                                                                               |
| Verdict                               | <Needs fix on development \| Fixed on development, not released \| Already fixed / shipped \| Covered by open PR \| Duplicate \| Not actionable / not a bug> |

**Evidence**

- Tip check: <command or file read + result in one line each>
- History: <related PRs/issues/commits if any>
- Repro: <done / not attempted — why>

**Gaps:** <what was not verified>

**Recommended next:** <fix on tip / close as shipped / wait on PR #n / ask reporter for X>
```

## Security (issue or PR — public / redacted)

Keep the **public** comment short and scannable. Full matrix, scope-script JSON, abuse paths → **chat**.

```markdown
## [GD] Security review

**PR / issue:** `#N` @ `<short-sha>`  
**Decision:** Pass | Pass after fixes | Do not ship yet  
**Risk:** Low | Medium | High | Critical

### Findings

none confirmed

<!-- Or, when there are findings: -->

| Severity | Area  | What (redacted)              | Next                    |
| -------- | ----- | ---------------------------- | ----------------------- |
| high     | authz | <one line, no exploit steps> | fixed in `<sha>` / open |

### Summary

<3–4 substantive sentences: (1) what was reviewed on this tip, (2) overall risk / whether anything is exploitable now, (3) what changed or was already solid, (4) what residual risk remains if any>

### Residual

- <only real leftovers; or `none`>

### Fixes this session

- none
<!-- or: - `<sha>` — <one line> -->
```

**Do not** put on the public comment (chat-only / omit):

- Long `requiredSurfaces=[…]` / scope-script dumps
- Method essays (“github-delivery security-review.md + … not Cursor harness…”)
- Path laundry lists in **Scope** (at most 3–5 key surfaces in Summary if needed)
- A findings table whose only row is “none confirmed…” stuffed into every column
- Full coverage matrix (done/n/a for every surface)

Anti-patterns: walls of inline metadata; empty findings tables; repeating the same “none” five times.

Full coverage matrix + abuse paths stay in **chat**. If too sensitive for a useful public table, use the short “details shared privately” form in `security-review.md`.

## Full-review / re-review verdict (PR)

```markdown
## [GD] Verdict: <approve-comment | changes-requested | not-useful | gated>
<!-- github-delivery:full-review-verdict run:<full-review-run-id> head:<reviewed-head-sha> -->

### TLDR

- **PR:** `#N` — <title>
- **Head:** `<short-sha>` on `<base>` (mergeStateStatus: `…`)
- **Decision:** <one line: useful and ready / needs N fixes / not useful / gated>
- **Usefulness:** <one line — fixes real bug or delivers claimed value; cite issue>
- **Bugs:** none blocking / <each concrete blocker in one line with `path` and why it matters>
- **Security:** none / <redacted finding class + severity>
- **Spec / standards:** clean / <gap in one line>
- **Reviews:** <humans + bots state in one line>
- **Base / CI:** green on `<sha>` / failing `job-name` / **owner action: update from `<base>`** (foreign PR)
- **Gate:** none / draft|WIP|do-not-merge / hard blocker: <…>
- **Owner actions (foreign PR):** none / update from latest base / apply N simplification candidates (list in the full verdict)
- **Bottom line:** <one paragraph: ship / fix these N items / not useful because …>

<details>
<summary><b>Full verdict</b></summary>

### Semantic propagation

- **Concepts audited:** ...
- **Authoritative sources:** ...
- **Producers and consumers checked:** ...
- **Public/derived representations checked:** ...
- **Material variant partitions checked:** ...
- **Positive and negative assertions checked:** ...
- **Unmapped surfaces:** none | ...
- **Unproven equivalence assumptions:** none | ...
- **Representation mismatches:** none | ...
- **Variant coverage gaps:** none | ...
- **Axis verdict:** pass | blocked
**Linked:** `#…` / none

### Usefulness

<Does it fix a real bug / deliver claimed value? Cite issue + user-visible effect.>

### Bugs / correctness

- Method: bug-review.md — Bugbot: yes/n/a-unavailable/skipDeep; static: run/n-a; trio (Finder→Challenger→Arbiter): done/skipDeep; complementary: done/skipDeep (`silent_failures`/`resource_leaks`/`edge_cases`)
- Findings: none blocking / <list with `path` + why it matters + confidence>
- Fixed this session: none / <sha + summary>

### Security

- Scope reviewed: <auth / input / …>
- Findings: none / <redacted one-liners>
- Fixed this session: none / <sha>

### Spec / standards

- Spec source: linked issue / PR body / none
- Gaps: none / <what drifts from claimed behavior or repo norms>

### Reviews

- Owners/maintainers: none open / addressed <threads> / pending @login (bare `@`, never backticked)
- Bots (CodeRabbit/Codex/Bugbot): cleared / declined <nit> with rationale / open <id>

### Base / CI

- Behind/conflicts: clean / updated in `<sha>` / **owner action: update from `<base>`** (foreign PR) / **DIRTY** (blocker)
- Required checks: green / failing `job-name` (branch vs flake)
- Local tip compile/tests: <command + result>

### Simplification (for the PR owner)

- <only when simplify was requested and the PR is not ours: bounded candidate list with file/location, problem, proposed change, risk, and validation per candidate; nothing was edited or pushed>

### Gate

none / draft|WIP|do-not-merge / hard blocker: <…>

### Bottom line

<One paragraph: ship / fix these N items / not useful because …>

</details>
When pinging a person, use bare `@login` (e.g. @user) — never `` `@login` ``.
```

## Merge-ready (PR)

```markdown
## [GD] Merge ready

**PR:** `#N` — <title>  
**Head:** `<short-sha>` → `<base>` (`mergeStateStatus: CLEAN`)  
**Linked issues:** `#…`

### Reviews

- **Humans (owners first):** <what was raised → fixed in `sha` / declined because … / none>
- **Bots:** <0 unresolved useful threads; notable declines with one-line rationale>
- **Own bug + security + spec/standards:** bug-review (Bugbot y/n/skip + complementary) + security-review done on tip; blockers fixed: <none / list>

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
## [GD] PR merge-ready

PR `#<pr>` (`<short title>`) is merge-ready on `<base>@<sha>`:

- Reviews (humans + bots) + own bug/security/spec: clean
- Required CI green; tip compiles

Not merged yet — waiting on merge when you want it.
```

## Status (PR)

Same evidence depth as merge-ready, labeled **Status** (not Merge ready). Each blocker gets a concrete next action.

```markdown
## [GD] Status

**Verdict:** not merge-ready / merge-ready bar met (not posted) / gated
**Head:** `<sha>` → `<base>` (`mergeStateStatus`)

| Gate                                | State          | Detail    |
| ----------------------------------- | -------------- | --------- |
| Owner/human threads                 | …              | …         |
| Bot threads                         | …              | …         |
| Own reviews                         | done / missing | …         |
| Tip / conflicts                     | …              | …         |
| Required CI                         | …              | name jobs |
| Policy (CODEOWNERS/approvals/queue) | …              | …         |
| Settle                              | n/a for status | —         |

**What’s left:** <ordered list of concrete actions>
```

## Merge thanks (PR + issue)

Still short, but concrete:

**PR (other author):**

```markdown
Thanks @author — merging this.

Why it helps: <2–3 sentences: user-visible bug/value, key change in `path`/behavior, linked `#issue` if any>

Ship it.
```

(Replace `author` with the real login; keep the `@` **outside** any backticks.)

**Issue (after merge):**

```markdown
Thanks @issue_author — fixed by PR `#<n>` (`<short-sha>`): <what changed for users / which failure mode is gone>.
```
