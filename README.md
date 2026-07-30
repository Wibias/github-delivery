# shipping-github

One Agent Skill for the whole GitHub **ship loop** — from “is this issue still open?” to “merge it and thank the reporter” — without pasting the same long prompt every time.

Thin babysit skills watch CI. This one runs the **workflows you actually repeat**: fix review noise, wait for the next bot round, decide what’s left, review for real bugs/security, and close the loop on the issue when you merge.

## Why it helps

Shipping a PR is rarely one green check. It’s a grind of:

- CodeRabbit / Codex / humans leaving another round of comments after every push  
- CI flakes vs real branch failures  
- “Is this already fixed on `dev` but not on the release line?”  
- Opening a PR for an issue, then babysitting it to merge-ready **without** merging yet  
- Merging with a short why-it-helps note — and not thanking yourself  

**shipping-github** turns those into named routes the agent follows consistently:

| Pain | What the skill does |
|---|---|
| Same mega-prompt every session | Short triggers → dedicated workflows under `references/` |
| Bot + human review ping-pong | Triage owners/maintainers first, then bots; wait with caps; recheck |
| Agent spam on GitHub | No auto-replies to humans without your exact text; limited thread resolves |
| Flaky CI “fixed” by rewriting tests | Classify branch vs flake; retry flakes (budget); don’t weaken CI |
| Draft / WIP merged by accident | Hard gates before merge-ready claims or merge |
| Green ≠ done watching | Optional **watch** mode: keep polling until merged/closed or a real blocker |
| Merge without closing the social loop | Thanks + why-it-helps on the PR; thank the **issue** author; close when appropriate |
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

- `fix coderabbit/codex on pr #42 and make it merge ready`
- `babysit / watch pr #42`
- `what's left on pr #42`
- `research issue #88 — fixed on dev but not main?`
- `create a pr for issue #88 … merge ready, don't merge`
- `full review on pr #42`
- `security review on pr #42`
- `merge pr #42`

The skill routes to `references/*.md` and always loads `references/shared-rules.md` first.

## Boundary

| Skill | Owns |
|---|---|
| **shipping-github** | GitHub issue/PR ship loop, watch/babysit, merge ceremony |
| **git-workflow-and-versioning** | Local commit discipline, semver, changelog *authoring* (this skill only nudges that a user-facing PR may need an entry) |
| Cursor **babysit** | Thin conflict/CI stub — optional; this skill covers richer watch + the full ship pack |

## Validation

Structural + evidence gates use [Skill Ratchet](https://github.com/Wibias/skill-ratchet):

```bash
node /path/to/skill-ratchet/scripts/skill-ratchet.mjs validate --skill-root "$PWD"
```

## License

MIT
