# shipping-github

One Agent Skill for the whole GitHub **ship loop** — from “is this issue still a problem on latest `dev`?” to “merge it and thank the reporter” — without pasting the same long prompt every time.

Thin babysit skills (Cursor built-in, OpenAI `babysit-pr`, Claude marketplace copies) mostly watch CI. This skill owns the **workflows you actually repeat**: research issues, open linked PRs only when needed, fix owner/bot review noise, wait for the next round, decide what’s left, review for real bugs/security, settle before claiming ready, and close the social loop when you merge.

## Why it helps

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
| Watch merges `dev` then only waits CI | Forbidden — run `watch-wake-gate.mjs`; exit `1` = fix OWNER top-level comments first |
| Cursor/Codex thin babysit steals the prompt | Personal redirects `overrides/babysit` + `overrides/babysit-pr` → this skill |
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
| Vague “looks good / CI green” reviews | **`comment-depth.md`** — research, security, verdict, merge-ready, status with paths/SHAs/evidence |
| Shallow security “no findings” | `security-scope.mjs` + coverage matrix + HIGH/MEDIUM confidence + Do-Not-Flag; crypto/session, business-logic, removed-controls, IaC/Docker, **Agentic Skills Top 10** when skill/MCP paths change; High+ pass gate; auto `ai-agent-security` / deps audit when flagged; **never** auto red-team second pass |
| Flaky CI “fixed” by rewriting tests | Classify carefully — **don’t** weaken CI; **do** harden real test timeouts instead of burning reruns |
| Draft / WIP merged by accident | Hard gates before merge-ready claims or merge; draft→ready only after ask |
| Rate-limit thrash on dense polls | Composio GraphQL rate limit → `gh` fallback; backoff |
| Bare `gh pr merge` skips ceremony | Why-it-helps on PR; **thank issue author** even after `Fixes` auto-close; never done without that |

Shared rules live in one place (`references/shared-rules.md`): scope lock, git safety (no force-push, stop on dirty trees), evidence sweep before “ready.”

## Workflows

| Ask something like… | Loads |
|---|---|
| Fix CodeRabbit/Codex / humans → merge-ready | `references/fix-pr-bots.md` |
| Watch / monitor / babysit until merged/closed | `references/watch-pr.md` |
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
| `scripts/watch-wake-gate.mjs` | Exit `1` until a **non-merge** commit addresses OWNER comments **and** PR is not DIRTY/BEHIND — ACK-only does not clear |
| `scripts/security-scope.mjs` | PR file → required security surfaces (incl. crypto/session, business-logic, IaC/Docker, removed-controls, **agentic skills/MCP**); flags `ai-agent-security` + AST10 + deps audit; `adversarialPassDefault: false` |

### Security review + adversarial / red-team

Normal **security review** (`references/security-review.md`) is defensive: scope script → coverage matrix → HIGH-confidence findings → High+ pass gate. Skill/MCP install paths also pull **Agentic Skills Top 10** (`references/agentic-skills-top10.md`) + `ai-agent-security`.

**Adversarial / red-team second pass** (garak, promptfoo, PyRIT, extra attack subagent):

| Rule | Detail |
|---|---|
| Default | **Never** on the agent’s own initiative (`adversarialPassDefault: false` in scope JSON) |
| When allowed | Only if **you** explicitly ask this session — e.g. “adversarial pass”, “red team”, “red-team”, “second security pass”, “run garak/promptfoo” |
| Not enough | Saying “security review” / “yes” to the security offer / AST10 flag / `ai-agent-security` mentioning red-teaming |
| Pass gate | Does **not** block a normal **Pass** unless you said the review is incomplete without it |

Policy lives in `security-review.md` §1b, hard rule #12 in `SKILL.md`, `shared-rules.md`, and scope `instructions[]`.

### Watch ordering (hard)

Every watch wake:

1. Run `watch-wake-gate.mjs` — exit `1` → triage OWNER comments (top-level conversation counts; not only inline threads). Clear with a **non-merge** commit or `[shipping-github] Addressed owner feedback — …`.
2. Then tip-update if behind.
3. Then CI / bots.

Never: merge `dev` → idle on `windows-latest` + CodeRabbit while an owner note is still open.

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

### Merge ceremony (required)

`merge-pr` is not bare `gh pr merge`:

1. Why-it-helps PR comment (`@thanks` PR author only if not you)
2. Merge
3. For **each** linked/fixed issue: thank the **issue** author (omit `@` if you are the reporter) — **even if** GitHub already auto-closed via `Fixes`
4. Post-merge cleanup

Multi-PR merges (“merge 775 and 778”) run the full ceremony **per PR**.

## Competing babysit skills

| Source | Path / install | Problem |
|---|---|---|
| Cursor built-in **babysit** | `~/.cursor/skills-cursor/babysit` (re-syncs if deleted) | Thin conflict/CI stub; merge-base → wait-on-CI |
| OpenAI optional **babysit-pr** | `npx skills add … --skill babysit-pr` / `.codex/skills/babysit-pr` | Watcher script loop; steals watch/babysit prompts if installed |
| Claude marketplace copies | e.g. ce-babysit-pr / skills.sh babysit-pr | Same class of conflict if installed |

**Mitigations shipped with this repo:**

1. Prefer **shipping-github** (description leads with babysit/watch/monitor).
2. Personal redirects from `overrides/`:
   - `babysit` → shipping-github watch/fix
   - `babysit-pr` → shipping-github watch/fix (preempt Codex/Claude installs)
3. Cursor user rule: prefer shipping-github over built-in babysit.
4. Hard gate: `scripts/watch-wake-gate.mjs` on every watch wake.

You cannot permanently delete Cursor’s built-in; win on discovery + redirect instead.

## Install

Copy or symlink this folder into agent skills directories:

```text
~/.agents/skills/shipping-github
~/.cursor/skills/shipping-github
~/.codex/skills/shipping-github      # optional, for Codex
~/.claude/skills/shipping-github     # optional, for Claude Code
```

Also install the redirects (same machine):

```text
~/.agents/skills/babysit      ← overrides/babysit/
~/.agents/skills/babysit-pr   ← overrides/babysit-pr/
~/.cursor/skills/babysit
~/.cursor/skills/babysit-pr
~/.codex/skills/babysit       # optional
~/.codex/skills/babysit-pr    # optional
```

Folder name for the main skill must stay `shipping-github` (matches frontmatter `name`).

## Requirements

- Git
- [GitHub CLI](https://cli.github.com/) (`gh auth login`)
- Node.js (for `scripts/*.mjs` helpers)
- Optional: Composio GitHub toolkit connected (faster rate-limit checks + inline reply helper)

## Quick use

- `research issue #88` / `research issues #88 #91`
- `create a pr for issue #88 … merge ready, don't merge`
- `create separate PRs for #52 and #62` — **explicit batch only**
- `fix coderabbit/codex on pr #42 and make it merge ready`
- `what's left on pr #42` — same evidence bar as merge-ready
- `watch pr #42` / `babysit pr #42` — reviews first (wake gate), then CI, until merged/closed
- `full review on pr #42` — babysit to green + verdict
- `security review on pr #42`
- `merge pr #42` / `merge pr 775 and 778` — full ceremony per PR, including issue-author thanks

## Boundary

| Skill | Owns |
|---|---|
| **shipping-github** | GitHub issue/PR ship loop, research-on-tip, watch CI/reviews, merge ceremony, gate helpers, babysit redirects |
| **issue-workflow** | Filing/breaking down tracker artifacts (PRDs, slices) — not “is it fixed on tip?” |
| **git-workflow-and-versioning** | Local commit discipline, semver, changelog *authoring*, release tags (this skill only nudges missing entries) |
| Cursor **babysit** / OpenAI **babysit-pr** | Thin watcher stubs — redirected away when personal overrides are installed |
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
