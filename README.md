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
| Unclear if an issue is still real | Research on latest development tip: fixed? open PR? duplicate? priority; **comment on the issue** |
| Duplicate PRs for the same issue | Create-PR preflight reports “already fixed / PR open / duplicate” **before** coding |
| Bot + human review ping-pong | Triage owners/maintainers first, then bots; wait with caps; recheck |
| Agent spam on GitHub | No auto-replies to humans without your exact text; limited thread resolves |
| Flaky CI “fixed” by rewriting tests | Classify branch vs flake; retry flakes (budget); don’t weaken CI |
| Draft / WIP merged by accident | Hard gates before merge-ready claims or merge |
| CI green but more reviews may arrive | **Watch PR** — keep polling CI + new review comments until the PR is merged/closed or blocked (not a one-shot status check) |
| Merge without closing the social loop | Thanks + why-it-helps on the PR; thank the **issue** author; auto-close when linked |
| Security/API PRs slipping past | Explicit security review, or ask when the PR text mentions security/API |

Shared rules live in one place (`references/shared-rules.md`): scope lock, git safety (no force-push, stop on dirty trees), evidence sweep before “ready.”

## Install

Copy or symlink this folder into your agent skills directory, for example:

```text
~/.agents/skills/shipping-github
```

Folder name must stay `shipping-github` (matches frontmatter `name`).

## Requirements

- Git
- [GitHub CLI](https://cli.github.com/) (`gh auth login`)

## Quick use

Ask the agent things like:

- `research issue #88` / `research issues #88 #91` — still broken on latest development? fixed? open PR? duplicate? priority; posts a review comment on each issue  
- `create a pr for issue #88 … merge ready, don't merge` — preflight first (needed? already fixed? PR open?); links issue↔PR both ways  
- `fix coderabbit/codex on pr #42 and make it merge ready`  
- `what's left on pr #42` — one-shot status  
- `watch pr #42` — keep monitoring CI + new reviews until merged/closed or a hard blocker  
- `full review on pr #42`  
- `security review on pr #42`  
- `merge pr #42` — thanks PR author (not yourself) + thank issue author + close issue when fixed  

The skill routes to `references/*.md` and always loads `references/shared-rules.md` first.

## Boundary

| Skill | Owns |
|---|---|
| **shipping-github** | GitHub issue/PR ship loop, research-on-tip, watch CI/reviews, merge ceremony |
| **issue-workflow** | Filing/breaking down tracker artifacts (PRDs, slices) — not “is it fixed on tip?” |
| **git-workflow-and-versioning** | Local commit discipline, semver, changelog *authoring* (this skill only nudges that a user-facing PR may need an entry) |
| Cursor **babysit** | Thin conflict/CI stub — optional; this skill covers richer watch + the full ship pack |

## Validation

Structural + evidence gates use [Skill Ratchet](https://github.com/Wibias/skill-ratchet):

```bash
node /path/to/skill-ratchet/scripts/skill-ratchet.mjs validate --skill-root "$PWD"
```

## License

MIT
