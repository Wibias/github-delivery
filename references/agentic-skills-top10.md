# Agentic Skills Top 10 (thin PR checklist)

Use when `security-scope.mjs` sets **`requireAgenticSkillsTop10: true`** (skill packages, MCP install/config, agent skill manifests in the diff).

This is **skill/MCP supply-chain review**, not a full classic app ASVS pass. Load skill **`ai-agent-security`** (especially `references/mcp-tool-security.md` + prompt-injection / tool governance) and walk this table.

Source shape: [OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/) (AST01–AST10). Mark each row `done` + one-liner, or `n/a` + why.

| ID | Risk | What to prove on this diff |
|---|---|---|
| **AST01** | Malicious Skills | No hidden exfil / reverse-shell / “ignore previous instructions” / credential harvest in skill prose, scripts, or side-loaded files |
| **AST02** | Supply Chain Compromise | Install/source provenance clear (pinned URL/commit/registry); no unsigned “curl \| sh” skill fetch; trust path documented if third-party |
| **AST03** | Over-Privileged Skills | Tools/permissions least-privilege; no broad filesystem/network/shell unless required and justified; destructive actions need HITL |
| **AST04** | Insecure Metadata | `SKILL.md` / YAML frontmatter honest (name, description, triggers); no brand impersonation; no untrusted HTML/script in metadata |
| **AST05** | Untrusted External Instructions | Remote refs / fetched docs / URLs in the skill are pinned or inlined; treat external content as untrusted (injection) |
| **AST06** | Weak Isolation | Skill does not silently require host-wide privileges; sandbox/container expectations documented when it needs elevated access |
| **AST07** | Update Drift | Versions/pins for deps or remote skill sources; no floating `@latest` trust for high-impact install paths without note |
| **AST08** | Poor Scanning | Secrets scan + manual read of scripts; do not rely on “looks fine” filename alone |
| **AST09** | No Governance | Clear owner/purpose in description; inventory-friendly naming; no silent auto-install of further skills/MCP servers |
| **AST10** | Cross-Platform Reuse | If packaged for multiple agents (Cursor/Claude/Codex), same trust/permission story on each; no platform-specific privilege smuggling |

## MCP-specific extras (with `ai-agent-security`)

When MCP server configs or tool definitions change:

- Tool descriptions cannot smuggle instructions (tool poisoning)
- Arguments schema-validated; deny-by-default allowlist
- No SSRF-friendly unconstrained URL fetch tools without policy
- Auth tokens not embedded in skill text or committed configs

## Confidence

Same as `security-review.md`: only **HIGH** confidence → Confirmed findings. AST rows without a concrete abuse path → Needs verification or residual.

## Not this checklist

- Ordinary app PR without skill/MCP packaging → use standard matrix + `requireAiAgentSecurity` only when LLM/tool code is touched.
- **Adversarial / red-team second pass** (garak, promptfoo, PyRIT, extra attack subagent) → **only if the user explicitly asks** — never from this checklist alone.
