# shipping-github

One Agent Skill for the whole GitHub **ship loop** — from “is this issue still a problem on latest `dev`?” to “merge it and thank the reporter” — without pasting the same long prompt every time.

Thin babysit skills watch CI. This one runs the **workflows you actually repeat**: research issues (still broken? duplicate? open PR? priority?), open linked PRs only when needed, fix review noise, wait for the next bot round, decide what’s left, review for real bugs/security, and close the loop when you merge.

## Why it helps

Shipping a PR is rarely one green check. It’s a grind of:

- “Is #88 even still valid on tip of development?”
- CodeRabbit / Codex / humans leaving another round after every push
- CI flakes vs real branch failures
- Opening a second PR when one already exists
- Merging without thanking the reporter — or thanking yourself

**shipping-github** turns those into named routes the agent follows consistently:

| Pain | What the skill does |
|---|---|
| Same mega-prompt every session | Short triggers → dedicated workflows under `references/` |
| Unclear if an issue is still real | Research on latest development tip: fixed? open PR? duplicate? **security relevance**? priority; **comment on the issue** |
| Duplicate PRs / fork-only PRs / comment spam | Create-PR: one PR unless batch asked; canonical repo only; verify link + assign self; edit comments never double-post |
| Bot + human review ping-pong | Triage owners/maintainers first, then bots; **own bug + security + Spec/Standards**; keep going until merge-ready |
| Soft “needs maintainer ack” while CI is red | Soft opinions are **not** stop conditions; babysit until green / hard blocker |
| 4+ PRs babysat one-by-one (too slow) | **>3 PRs/issues → subagent fan-out** (one per target, parallel/chunked) |
| Green on a stale base | Update from base, then **compile against tip** before ready / approve / merge |
| False merge-ready with open threads | GraphQL `reviewThreads` must be clear; linked-issue notify when ready is posted |
| CI green, bots still arriving | **Thin settle** (~3–5 min quiet + recheck) before merge-ready / approve-comment |
| Watch merges `dev` then only waits CI | Forbidden — **reviews/CODEOWNERS first**, then tip-update, then CI |
| Watch “ready” ≠ merge-ready | Watch milestones are CI/review quiet only — full bar is fix-pr/full-review |
| Status looser than merge-ready | Status uses the **same** evidence bar (tip, protection, CODEOWNERS, stacks, policy) |
| Required checks / CODEOWNERS / queue / stale approvals | Helpers: `required-checks`, `codeowners-for-pr`, `review-threads`, `pr-policy-gate` |
| Merge queue “queued” treated as done | Queued ≠ merged; keep watching until actually merged |
| CODEOWNERS file but no enforcement | Detect **require code owner reviews** vs suggestion-only |
| Approval on old SHA after push | Re-check dismiss-stale / last-push-approval on tip |
| Mid-stack merged as if trunk | Detect stack → hand off to **manage-stacked-prs** |
| Oversized PR / finish branch | Hand off: **split-to-prs**, **finishing-a-development-branch** |
| Can’t push fork head but “fixed” anyway | Fork-head unwritable → hard stop |
| Windows comment mojibake (`Run` → `�un`) | UTF-8 file + `gh --input` / `--body-file` (never PowerShell string pipes) |
| Markdown `\_` spam in comments | Backticks for identifiers; no backslash-escaping |
| Agent spam on GitHub | No auto-replies to humans without your exact text; limited thread resolves; inline replies in-thread |
| Flaky CI “fixed” by rewriting tests | Classify branch vs flake; retry flakes (budget); don’t weaken CI |
| Draft / WIP merged by accident | Hard gates before merge-ready claims or merge; draft→ready only after ask |
| Rate-limit thrash on dense polls | Composio GraphQL rate limit → `gh` fallback; backoff |
| Merge without closing the social loop | Thanks + why-it-helps on the PR; thank the **issue** author (even after auto-close); never bare `gh pr merge` |

Shared rules live in one place (`references/shared-rules.md`): scope lock, git safety (no force-push, stop on dirty trees), evidence sweep before “ready.”

## Workflows

| Ask something like… | Loads |
|---|---|
| Fix CodeRabbit/Codex / humans → merge-ready | `references/fix-pr-bots.md` |
| Watch / monitor until merged/closed | `references/watch-pr.md` |
| Re-review after your review + new bots | `references/re-review-pr.md` |
| Research issue(s) on latest development | `references/research-issue.md` |
| Create PR for issue → merge-ready | `references/create-pr-for-issue.md` |
| Full review + verdict (babysit to green) | `references/full-review-pr.md` |
| Security review | `references/security-review.md` |
| What’s left / is it merge ready? | `references/status.md` |
| Merge + thanks + issue close-out | `references/merge-pr.md` |

Router: `SKILL.md`. Always loads `references/shared-rules.md` first.

## Gate helpers

Concrete evidence scripts (see `references/gate-helpers.md`):

| Script | Role |
|---|---|
| `scripts/required-checks.mjs` | Required CI contexts / modern checks / rulesets + live rollup |
| `scripts/codeowners-for-pr.mjs` | Map PR files → CODEOWNERS on base + review requests |
| `scripts/review-threads.mjs` | Paginate GraphQL unresolved review threads (+ optional resolve) |
| `scripts/pr-policy-gate.mjs` | Code-owner **enforcement**, dismiss-stale / last-push approvals, merge queue / `merge_group` warn |

## Reliability bar (what “merge ready” means)

Before `[shipping-github] Merge ready` (and full-review `approve-comment`):

1. Useful human + bot threads clear (or declined with policy)
2. Own **bug + security + Spec/Standards** done
3. Up to date with base and **compiles against tip**
4. Required CI green (flake budget respected)
5. Protection / `reviewDecision` / enforced CODEOWNERS / stale-approval / merge-queue policy clear
6. Unresolved GraphQL review threads clear
7. **Thin settle** elapsed (~3–5 min quiet + recheck; activity resets; two-window cap)
8. Linked-issue notify posted (when issues are linked)

Watch may report “CI/reviews quiet — still watching” without claiming that full bar. Status never uses a looser bar than merge-ready.

## Install

Copy or symlink this folder into your agent skills directory, for example:

```text
~/.agents/skills/shipping-github
```

Folder name must stay `shipping-github` (matches frontmatter `name`).

## Requirements

- Git
- [GitHub CLI](https://cli.github.com/) (`gh auth login`)
- Node.js (for `scripts/*.mjs` helpers)
- Optional: Composio GitHub toolkit connected (faster rate-limit checks + inline reply helper)

## Quick use

Ask the agent things like:

- `research issue #88` / `research issues #88 #91` — still broken on latest development? fixed? open PR? duplicate? security relevance? priority; posts a review comment on each issue; asks before security review if relevant
- `create a pr for issue #88 … merge ready, don't merge` — preflight first; **one** PR on the **issue’s** repo (not fork-only); `Fixes #N` verified; assign yourself; one issue comment (edit if incomplete — never a second cut-off comment)
- `create separate PRs for #52 and #62` — **explicit batch only**; still one canonical PR per issue, no fork-only, same link/assign/comment rules
- `fix coderabbit/codex on pr #42 and make it merge ready`
- `what's left on pr #42` — one-shot status (same evidence bar)
- `watch pr #42` — keep monitoring CI + new reviews until merged/closed or a hard blocker
- `full review on pr #42` — babysit to green + verdict (not soft-gated by “needs ack”)
- `security review on pr #42`
- `merge pr #42` — thanks PR author (not yourself) + thank issue author + close issue when fixed

## Boundary

| Skill | Owns |
|---|---|
| **shipping-github** | GitHub issue/PR ship loop, research-on-tip, watch CI/reviews, merge ceremony, gate helpers |
| **issue-workflow** | Filing/breaking down tracker artifacts (PRDs, slices) — not “is it fixed on tip?” |
| **git-workflow-and-versioning** | Local commit discipline, semver, changelog *authoring*, release tags (this skill only nudges missing entries) |
| Cursor **babysit** | Thin conflict/CI stub — optional; this skill covers richer watch + the full ship pack |
| **manage-stacked-prs** | Stack inspect / restack / retarget / bottom-up merge — shipping detects stacks and hands off |
| **split-to-prs** | Split oversized branch into reviewable PRs — hand off when scope explodes |
| **finishing-a-development-branch** | Post-ship branch/worktree cleanup menu — hand off after merge |
| **review** | Spec + Standards axes — shipping runs/hands off on merge-ready paths |

## Validation

Structural + evidence gates use [Skill Ratchet](https://github.com/Wibias/skill-ratchet):

```bash
node /path/to/skill-ratchet/scripts/skill-ratchet.mjs validate --skill-root "$PWD"
```

## License

MIT
