# Security review

**Trigger:** “security review”, “security review on pr #N”, “security review on these issues”, “/review-security”, or **yes** after a research security ask.

## Goal

Run a **hardened, evidence-based** security review on the named **PR(s) and/or issue area(s)**. Prefer finding real exploitable issues over a shallow “LGTM.” Fix what can/should be fixed when a PR branch is in scope. When reviewing **issues**, post a **redacted** review on each issue and give the **full** findings (including abuse paths) **only in chat**.

Do **not** merge unless asked.

**Bar:** a security review that skips applicable surfaces or tools “because focused” is incomplete. Use the coverage matrix below; mark each row `done` / `n/a (why)` — never silently omit.

## Targets

| User said | Target |
|---|---|
| PR #N / current branch | Checkout PR head (shared subagent preflight); review **branch changes vs PR base** |
| Issue(s) #N… (from research ask) | Review implicated code on latest development tip (+ open covering PR if any). Post on **each** issue when posting was requested |

## Public vs chat (mandatory)

Follow **Public security disclosure** in `shared-rules.md`. Private GHSA / advisory IDs: chat-only detail; public posts redacted.

**Chat (to the user):** full findings — severity, affected code, impact, abuse/repro path, fix, verification. Include the completed **coverage matrix**.

**GitHub:** redacted but detailed — **Security** template in `references/comment-depth.md`. **Omit** exploit steps, payloads, bypass recipes, secret values.

Sensitive findings → short public “details shared privately” form + full table in chat. One idempotent comment per target.

## Mandatory method (do not skip)

Run in order. Skip a step only with an explicit `n/a` reason in the coverage matrix (tool missing, surface absent from diff).

### 1. Subagent / skill pass (required for PR diffs)

1. Checkout PR head (shared **Subagent preflight**).
2. Launch **exactly one** `security-review` subagent via `review-security` (`Diff: branch changes`; set base to the PR base when not the repo default).
3. If available, also load skill **`security-review`** and use `references/security-checks.md` as the category depth guide — do not invent a thinner checklist.
4. Subagent failure: retry once (shared preflight rules). If still failing → manual pass using the coverage matrix; say the subagent failed.

### 2. Secrets scan (required when checkout exists)

- Run secrets scan on the repo / changed paths when possible (`python …/security-review/scripts/scan_secrets.py <path>` or equivalent).
- Treat hits as **leads**; never print full secret values.
- If the scanner is unavailable: say so and manually inspect diff for keys, tokens, `.env`, private URLs with credentials.

### 3. Static leads (when installed)

- **Semgrep** on changed paths when available.
- **CodeQL** when dataflow/taint across files matters and the repo has it.
- Missing tool → `n/a (not installed)` — still do the manual category pass.

### 4. Coverage matrix (required in chat)

For every security review, fill this table. Each row: `done` + evidence one-liner, or `n/a` + why.

| Surface | What to prove |
|---|---|
| **Authn** | How identity is established; fail-open defaults; session/token handling on changed paths |
| **Authz** | Server-side enforcement (not UI-only); object/tenant boundaries; privilege escalation |
| **Injection** | User input → query/template/shell/HTML/path; validate near boundary |
| **SSRF / outbound** | Destination policy, private/metadata ranges, redirects, URL allowlists |
| **Secrets / config** | No secrets in client bundles, logs, commits; env naming; public/private key split |
| **Uploads / files** | Type/size/path traversal; storage ACLs |
| **Webhooks / payments** | Signature verification; replay; test vs live |
| **CI / GitHub Actions** | `pull_request_target`, fork checkout, broad tokens, prompt-injection into agents |
| **Supply chain** | Lockfile/deps install scripts; no unverified CVE claims |
| **Logging / privacy** | PII/secrets in logs; error leakage |
| **AI / agent / MCP** (if diff touches LLM, tools, prompts, MCP, RAG) | Prompt injection, tool poisoning, excessive agency — load skill **`ai-agent-security`** for those paths |
| **Credential destinations / providers** (if presets, baseUrl, OAuth, API keys) | Custom destinations preserved vs silently rewritten; routing authorization; who can point traffic where |
| **Variant analysis** | After any confirmed bug, search for the same pattern nearby |

**Cannot claim “no security issues”** unless every applicable row is `done` or honestly `n/a`. Residual risk must be listed.

### 5. Validate findings

- Confirmed = concrete abuse/failure path + impact + file evidence.
- Unproven leads → “Needs verification,” not Critical/High.
- Severity: Critical / High / Medium / Low / Info (same meanings as skill `security-review`).

## Domain heuristics (common ship-loop misses)

- **Provider / preset PRs:** `preserveCustomDestination` (or equivalent); same-name custom provider must not be canonicalized onto a new host; document routing auth when catalogs bundle third-party models.
- **Management / dashboard APIs:** authz on `/api/*`; Origin/CORS vs TLS terminators; admin token file ACLs.
- **Proxy / outbound:** private-network defaults vs SSRF; metadata/link-local deny.
- **Windows service / process control:** PID identity verification; no trust of healthz alone.
- **Fail-open production defaults:** treat as findings when prod can run insecurely.

## Steps

1. Resolve targets (bare `#N` per shared rules). Checkout when reviewing/fixing a PR.
2. Run **Mandatory method** (subagent → secrets → static leads → coverage matrix → validate).
3. Split output: **full + matrix → chat**; **redacted → GitHub** when posting.
4. PR in scope: triage; **fix** necessary/useful issues in this PR; push; recheck CI. Redacted request-changes / comments only on GitHub.
5. Chat summary must include: Security decision (`Pass` / `Pass after fixes` / `Do not ship yet`), risk level, confirmed findings, needs verification, coverage matrix, residual, fixes landed this session.

## Done when

- Subagent/skill pass attempted (or explicit failure + manual matrix)
- Secrets scan attempted or `n/a` justified
- Coverage matrix complete in chat (no silent skips)
- User has full exploit/fix detail in chat
- Public posts (if any) redacted + meet `comment-depth.md`
- Necessary in-PR fixes landed or declined with rationale
- AI/agent surfaces reviewed via `ai-agent-security` when the diff touches them
