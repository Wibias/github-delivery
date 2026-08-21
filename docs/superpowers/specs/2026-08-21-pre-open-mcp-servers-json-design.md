# Pre-open MCP `servers` JSON

## Status

Approved 2026-08-21 (Wave 3, GD-AUDIT-060 only). Branch from current `origin/main`. Do not bundle 061 `.mdc`, 062 Unicode `$`-anchor evasion, 065–067, or 069.

## Problem

`.vscode/mcp.json` with the live VS Code/Copilot `servers` key installing an `npx` package is security/bug `skip` and pre-open `ready`. JSON is not `logicFiles`. The agentic path already scores 1 for `mcp.json`, but `required` needs score ≥ 3. The added-line regex looks for `mcpServers`, so Copilot’s `servers` schema never becomes required unless the patch also contains `mcp` or `http`.

Same skip/ready for `mcp.json`, `.mcp.json`, and `claude_desktop_config.json` with that payload.

## Approach

- Treat those MCP install paths as operational policy (`isLogic`), same class as 059 instruction files.
- Match both `"servers":` and `mcpServers` on added lines for `agentic_skills_supply_chain`.
- Score those MCP install paths as required for `agentic_skills_supply_chain` and `ai_agent_mcp` so `requireAiAgentSecurity` is true.

Keep ordinary JSON (`tsconfig.json`) skip. Keep Cursor `mcpServers` required. Do not add `.mdc` or strip Unicode path suffixes.

## Tests

- `.vscode/mcp.json` `servers`+npx is in `logicFiles`, security/bug not `skip`, `evaluate` not `ready`, `requireAiAgentSecurity` true.
- Same for `mcp.json`, `.mcp.json`, `claude_desktop_config.json`.
- `tsconfig.json` stays skip/ready. Cursor `.cursor/mcp.json` `mcpServers` stays required.
