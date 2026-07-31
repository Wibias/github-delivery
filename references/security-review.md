# Security review

**Trigger:** “security review”, “security review on pr #N”, “security review on these issues”, “/review-security”, or **yes** after a research security ask.

## Goal

Run a **hardened, evidence-based** security review on the named **PR(s) and/or issue area(s)**. Prefer finding real exploitable issues over a shallow “LGTM.” Fix what can/should be fixed when a PR branch is in scope. When reviewing **issues**, post a **redacted** review on each issue and give the **full** findings (including abuse paths) **only in chat**.

Do **not** merge unless asked.

**Bar:** a security review that skips applicable surfaces or tools “because focused” is incomplete. Use **`scripts/security-scope.mjs`** (PR) + the coverage matrix; mark each required row `done` / `n/a (why)` — never silently omit.

## Targets

| User said | Target |
|---|---|
| PR #N / current branch | Checkout PR head (shared subagent preflight); review **branch changes vs PR base** |
| Issue(s) #N… (from research ask) | Review implicated code on latest development tip (+ open covering PR if any). Post on **each** issue when posting was requested |

## Public vs chat (mandatory)

Follow **Public security disclosure** in `shared-rules.md`. Private GHSA / advisory IDs: chat-only detail; public posts redacted.

**Chat (to the user):** full findings — severity, affected code, impact, abuse/repro path, fix, verification. Include completed **coverage matrix** + scope script output summary.

**GitHub:** redacted but detailed — **Security** template in `references/comment-depth.md`. **Omit** exploit steps, payloads, bypass recipes, secret values.

Sensitive findings → short public “details shared privately” form + full table in chat. One idempotent comment per target.

## Mandatory method (do not skip)

Run in order. Skip a step only with an explicit `n/a` reason (tool missing, surface absent).

### 0. Scope script (required for PRs)

```bash
node "<shipping-github>/scripts/security-scope.mjs" OWNER/REPO N
```

- Cover every `requiredSurfaces[]` row in the chat matrix.
- If `requireAiAgentSecurity: true` → **must** load skill **`ai-agent-security`** and review those paths (not optional).
- If `requireDepsAudit: true` → run a package-manager audit as a **lead** (`bun audit` / `pnpm audit` / `npm audit` / `cargo audit` per `packageManager`). Do not invent CVEs; cite command output.
- Follow `instructions[]` from the JSON.

Issue-only (no PR): derive surfaces manually from implicated paths using the same categories; still apply AI/deps rules when those paths match.

### 1. Subagent / skill pass (required for PR diffs)

1. Checkout PR head (shared **Subagent preflight**).
2. Launch **exactly one** `security-review` subagent via `review-security` (`Diff: branch changes`; set base to the PR base when not the repo default).
3. Load skill **`security-review`** and use `references/security-checks.md` for category depth when available.
4. If scope says `requireAiAgentSecurity`: load **`ai-agent-security`** in the same session and apply its decision tree to touched LLM/tool/MCP/RAG paths.
5. Subagent failure: retry once. If still failing → manual pass using matrix + scope; say the subagent failed.

### 2. Secrets scan (required when checkout exists)

- Run secrets scan on the repo / changed paths when possible (`python …/security-review/scripts/scan_secrets.py <path>` or equivalent).
- Treat hits as **leads**; never print full secret values.
- If unavailable: say so and manually inspect the diff for keys/tokens/`.env`.

### 3. Static leads + deps audit

- **Semgrep** on changed paths when available.
- **CodeQL** when dataflow/taint matters and the repo has it.
- **Deps audit** when `requireDepsAudit` (scope script) — leads only.
- Missing tool → `n/a (not installed)` — still do the manual category pass.

### 4. Coverage matrix (required in chat)

Fill every **scope-required** surface plus any you touched. Each row: `done` + evidence one-liner, or `n/a` + why.

| Surface | What to prove |
|---|---|
| **Authn** | Identity establishment; fail-open defaults; session/token handling |
| **Authz** | Server-side enforcement; object/tenant boundaries; privilege escalation |
| **Injection** | User input → query/template/shell/HTML/path |
| **SSRF / outbound** | Destination policy; private/metadata ranges; redirects |
| **Secrets / config** | No secrets in client/logs/commits; env naming; key split |
| **Uploads / files** | Type/size/path traversal; storage ACLs |
| **Webhooks / payments** | Signature verification; replay; test vs live |
| **CI / GitHub Actions** | `pull_request_target`, fork checkout, broad tokens, agent prompt-injection |
| **Supply chain** | Lockfile/deps; audit leads when manifests change |
| **Logging / privacy** | PII/secrets in logs; error leakage |
| **AI / agent / MCP** | Prompt injection, tool poisoning, excessive agency (`ai-agent-security`) |
| **Credential destinations / providers** | Custom destinations preserved; routing authorization |
| **Variant analysis** | After any confirmed bug, search for the same pattern nearby |

**Cannot claim “no security issues”** unless every **required** row is `done` or honestly `n/a`. Residual risk must be listed.

### 5. Validate findings

- Confirmed = concrete abuse/failure path + impact + file evidence.
- Unproven leads → “Needs verification,” not Critical/High.
- Severity: Critical / High / Medium / Low / Info (skill `security-review` meanings).

### 6. Pass gate (shipping decision)

| Decision | Allowed only when |
|---|---|
| **Pass** | No open Critical/High. Medium/Low accepted or fixed. Required matrix complete. |
| **Pass after fixes** | All Critical/High fixed **in this PR** (or user explicitly accepted each remaining High/Critical in chat). Prefer a **regression test** for each fixed High/Critical; if none, state why not. Re-run secrets/scope-relevant checks on the new SHA when fixes landed. |
| **Do not ship yet** | Any Critical/High still open without explicit user accept, or required matrix incomplete, or `requireAiAgentSecurity` / `requireDepsAudit` skipped |

Never output **Pass** while High/Critical items are only “noted.”

## Domain heuristics (common ship-loop misses)

- **Provider / preset PRs:** `preserveCustomDestination` (or equivalent); same-name custom provider must not be canonicalized onto a new host; routing auth when catalogs bundle third-party models.
- **Management / dashboard APIs:** authz on `/api/*`; Origin/CORS vs TLS terminators; admin token file ACLs.
- **Proxy / outbound:** private-network defaults vs SSRF; metadata/link-local deny.
- **Windows service / process control:** PID identity verification; no trust of healthz alone.
- **Fail-open production defaults:** findings when prod can run insecurely.

## Steps

1. Resolve targets (bare `#N` per shared rules). Checkout when reviewing/fixing a PR.
2. Run **scope script** (PRs) → **Mandatory method** (subagent → AI skill if required → secrets → static/deps → matrix → validate → pass gate).
3. Split output: **full + matrix + scope summary → chat**; **redacted → GitHub** when posting.
4. PR in scope: triage; **fix** necessary/useful High/Critical (and useful Medium) in this PR; push; recheck CI. Redacted request-changes / comments only on GitHub.
5. Chat summary: Security decision, risk level, confirmed findings, needs verification, coverage matrix, scope `requiredSurfaces`, residual, fixes + regressions this session, explicit user accepts if any.

## Done when

- Scope script run for PRs (JSON summarized in chat)
- Subagent/skill pass attempted (or explicit failure + manual matrix)
- `ai-agent-security` loaded when scope requires it
- Deps audit run when scope requires it (or `n/a` with tool missing)
- Secrets scan attempted or `n/a` justified
- Coverage matrix complete for all **required** surfaces
- Pass gate satisfied for the stated decision
- User has full exploit/fix detail in chat
- Public posts (if any) redacted + meet `comment-depth.md`
- Necessary in-PR fixes landed or declined / user-accepted with rationale
