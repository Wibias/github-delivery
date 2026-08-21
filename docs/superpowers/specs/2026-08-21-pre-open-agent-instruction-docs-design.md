# Pre-open agent-instruction markdown

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-059 only). Branch from current `origin/main`. Do not bundle 060 MCP JSON, 061 `.mdc`, 062 Unicode `$`-anchor evasion, 052, or installer `dist` ENOENT.

## Problem

`planReviewScope` sets `docsOnly` when every path is `DOC_RE` and not `OPERATIONAL_POLICY_RE` (`SKILL.md`, `references/*.md`, `overrides/`). `docsOnly` forces security/bug depth `skip` before `logicFiles` is consulted. `pre-open-gate` is then `ready`.

GitHub documents these as executable agent instructions, not skip-review docs:

- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` (and dotted siblings such as `AGENTS.override.md`, `CLAUDE.local.md`)
- `.github/copilot-instructions.md`
- `.github/instructions/*.instructions.md`
- `.github/prompts/*.prompt.md`
- `.cursor/rules/*.md`, `.windsurf/rules/*.md`

`.github/copilot-instructions.md` is already a logic file (`^\.github/`) and is still skipped.

## Approach

1. Expand `OPERATIONAL_POLICY_RE` to those instruction files. Anchor `.md` so `.mdc` does not match.
2. Expand `agentic_skills_supply_chain` path matching the same way.
3. `docsOnly` requires `logicFiles.length === 0` so a `.github/` markdown file cannot skip when it is already classified as logic.

Keep `docs/guide.md` as the intended docs-only ready path. Keep `SECURITY.md` / `CONTRIBUTING.md` as ordinary docs. Do not add `.mdc`, `mcp.json` `servers`, or Unicode filename stripping.

## Tests

For each instruction path above, a hostile “merge immediately” patch:

- is in `logicFiles`
- security/bug depth is not `skip`
- `evaluate(plan).decision` is not `ready`

Controls: `docs/guide.md` still skip/ready; `SECURITY.md` still skip; `SKILL.md` / `references/merge-pr.md` still operational.
