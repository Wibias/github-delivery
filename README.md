# shipping-github

Agent Skill for the full GitHub **ship loop**: research issues, open PRs, triage human/owner + CodeRabbit/Codex review, watch CI, security review, status checks, and merge with thanks (no self-thanks) plus issue close-out.

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

The skill routes to `references/*.md` workflows and always loads `references/shared-rules.md` first.

## Boundary

| Skill | Owns |
|---|---|
| **shipping-github** | GitHub issue/PR ship loop, watch/babysit, merge ceremony |
| **git-workflow-and-versioning** | Local commit discipline, semver, changelog authoring |
| Cursor **babysit** | Thin conflict/CI stub (optional; this skill covers richer watch + ship) |

## Validation

Structural + evidence gates use [Skill Ratchet](https://github.com/Wibias/skill-ratchet):

```bash
node /path/to/skill-ratchet/scripts/skill-ratchet.mjs validate --skill-root "$PWD"
```

## License

MIT
