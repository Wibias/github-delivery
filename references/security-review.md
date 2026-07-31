# Security review

**Trigger:** “security review”, “security review on pr #N”, “security review on these issues”, “/review-security”, or **yes** after a research security ask.

**Adversarial / red-team second pass:** only when the user **explicitly** asks (e.g. “adversarial pass”, “red team”, “red-team”, “second security pass”, “run garak/promptfoo”). **Never** start it on your own — not after Pass, not because `ai-agent-security` mentions red-teaming, not because AST10 flagged.

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

**Chat (to the user):** full findings — severity, **confidence**, affected code, impact, abuse/repro path, fix, verification. Include completed **coverage matrix** + scope script output summary.

**GitHub:** short + scannable — **Security** template in `references/comment-depth.md` (decision, risk, findings or `none confirmed`, **3–4 substantive** summary sentences, residual, fixes). **Omit** exploit steps, payloads, bypass recipes, secret values. **Omit** scope-script dumps, method essays, and full coverage matrices on the public comment — those stay in chat.

Sensitive findings → short public “details shared privately” form + full table in chat. One idempotent comment per target.

## Mandatory method (do not skip)

Run in order. Skip a step only with an explicit `n/a` reason (tool missing, surface absent).

### 0. Scope script (required for PRs)

```bash
node "<shipping-github>/scripts/security-scope.mjs" OWNER/REPO N
```

- Cover every `requiredSurfaces[]` row in the chat matrix.
- If `requireAiAgentSecurity: true` → **must** load skill **`ai-agent-security`** and review those paths (defensive app/agent review — **not** a red-team suite).
- If `requireAgenticSkillsTop10: true` → **must** load **`references/agentic-skills-top10.md`** + **`ai-agent-security`** (MCP/tool refs) and cover AST01–AST10 for skill/MCP install paths.
- If `requireDepsAudit: true` → run a package-manager audit as a **lead** (`bun audit` / `pnpm audit` / `npm audit` / `cargo audit` per `packageManager`). Do not invent CVEs; cite command output.
- If `removedControlLeads` is non-empty → treat those deleted lines as **leads**; prove the control still exists elsewhere or file a finding.
- `adversarialPassDefault` is always `false` — ignore any temptation to “also red-team.”
- Follow `instructions[]` from the JSON.

Issue-only (no PR): derive surfaces manually from implicated paths using the same categories; still apply AI/deps/IaC/crypto/AST10 rules when those paths match; still scan for removed controls in the tip/PR diff when available.

### 1. In-session security pass (required for PR diffs)

**HARD RULE — never use the Cursor harness security agent.** Do **not** launch Task `subagent_type: "security-review"`, skill **`review-security`**, or any other built-in “Security Review” harness stub. Those are shallow and steal the prompt from this workflow. Security for shipping-github is **this file** only.

1. Checkout PR head (shared **Subagent preflight** — checkout rules still apply; bugbot may use them separately).
2. Review **branch changes vs PR base** in this session (parent), **or** one **general-purpose** subagent whose prompt says: follow `shipping-github` `references/security-review.md` + shared-rules for this PR — **never** `subagent_type: "security-review"`.
3. Load personal skill **`security-review`** (category checklist / `references/security-checks.md`) when available — that is a knowledge skill, not the Cursor harness launcher.
4. If scope says `requireAiAgentSecurity`: load **`ai-agent-security`** and apply its decision tree to touched LLM/tool/MCP/RAG paths (**defensive** controls only).
5. If scope says `requireAgenticSkillsTop10`: also load **`references/agentic-skills-top10.md`** and complete the AST01–AST10 matrix for skill/MCP install files.
6. If a helper subagent fails: retry once with the same shipping-github brief. If still failing → finish the matrix manually in-session; say the helper failed.

### 1b. Adversarial / red-team second pass (**explicit user ask only**)

**Default: skip. Hardcoded never-on-own.**

Do **not** launch a second attack-oriented pass unless this session’s user text clearly asks for it (examples: “adversarial pass”, “red team this”, “run garak”, “promptfoo red-team”, “second security pass”).

When (and only when) asked:

1. Say you are running the **optional** adversarial pass (not part of the normal Pass gate unless they said it blocks ship).
2. Use `ai-agent-security` red-team refs (`llm-red-teaming.md`) / tools if available; keep scope to the same PR/issue targets.
3. Authorized systems only; no probing third-party production you do not own.
4. Fold results into chat with confidence labels; public posts still redacted.

If not asked: do not offer unprompted, do not “also run” after Pass, do not treat AST10 or `ai-agent-security` as permission to red-team.

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
| **AI / agent / MCP** | Prompt injection, tool poisoning, excessive agency (`ai-agent-security`) — defensive |
| **Agentic skills supply chain** | AST01–AST10 via `references/agentic-skills-top10.md` when skill/MCP install paths change |
| **Credential destinations / providers** | Custom destinations preserved; routing authorization |
| **Crypto / session** | Hashing/JWT/`alg=none`/key handling; cookie `HttpOnly`/`Secure`/`SameSite`; TLS/cert footguns in touched code |
| **Business logic** | Step skipping, TOCTOU/races, entitlement/workflow bypass, multi-tenant scoping across steps |
| **Removed controls** | Diff deletions of auth/validation/sanitize/middleware — control still enforced or finding filed |
| **IaC / Docker** | Dockerfile/compose/K8s/Terraform: privileged containers, secrets in images, open ports, overly broad IAM/RBAC |
| **Variant analysis** | After any confirmed bug, search for the same pattern nearby |

**Cannot claim “no security issues”** unless every **required** row is `done` or honestly `n/a`. Residual risk must be listed.

### 5. Validate findings (confidence + Do-Not-Flag)

Research surrounding code before reporting. Diff-scoped report; codebase-deep verification.

#### Confidence (required label on every lead)

| Level | Criteria | Action |
|---|---|---|
| **HIGH** | Vulnerable pattern + attacker-controlled input (or missing control) **confirmed** via dataflow / call path | **Confirmed findings** with severity |
| **MEDIUM** | Vulnerable pattern present; input source, auth boundary, or exploitability unclear | **Needs verification** only — never Critical/High in Confirmed |
| **LOW** | Theoretical, style, or defense-in-depth with no realistic path | Do **not** list as a finding; optional one-line residual |

Severity (Critical/High/Medium/Low/Info) and confidence are independent. A High-severity *hypothesis* with MEDIUM confidence stays under Needs verification.

#### Do Not Flag

- Test-only / fixture / docs / commented-out / dead code (unless the ask is test-security).
- Patterns fed only by **constants** or **server-controlled** config (env, deploy settings, hardcoded allowlists) — unless that config is attacker-influenced (e.g. user-supplied URL stored then fetched).
- Framework-default mitigations without an escape hatch (e.g. React text nodes, ORM parameterized APIs). Flag the escape: `dangerouslySetInnerHTML`, `mark_safe`, `.raw()` / string-built SQL, `v-html`, shell/`exec` with user input.
- Missing security headers / verbose errors as Confirmed High — residual or Low/Info only unless they enable a concrete exploit in this diff.
- CVE names without an audit command / advisory evidence.

**Auth-gated ≠ skip authz:** paths that require login are still in scope for **IDOR / privilege escalation / tenant escape**. Only avoid claiming *unauthenticated* impact when auth is required.

#### Server-controlled (usually not attacker input)

Env vars, process config, build-time constants, operator-only admin config files — not request params/body/headers/URL/path, uploaded files, webhook payloads, or LLM/tool arguments from users.

### 6. Pass gate (shipping decision)

| Decision | Allowed only when |
|---|---|
| **Pass** | No open Critical/High **Confirmed (HIGH confidence)**. Medium/Low accepted or fixed. Required matrix complete. Confidence discipline applied. |
| **Pass after fixes** | All Critical/High Confirmed fixed **in this PR** (or user explicitly accepted each remaining High/Critical in chat). Prefer a **regression test** for each fixed High/Critical; if none, state why not. Re-run secrets/scope-relevant checks on the new SHA when fixes landed. |
| **Do not ship yet** | Any Critical/High Confirmed still open without explicit user accept, or required matrix incomplete, or `requireAiAgentSecurity` / `requireAgenticSkillsTop10` / `requireDepsAudit` / required IaC/crypto/removed-controls rows skipped |

Never output **Pass** while High/Critical items are only “noted,” MEDIUM-confidence, or Needs verification.

**Adversarial pass** does **not** block Pass unless the user said the review is incomplete without it.

### Bug handoff (lock / error-mapping diffs)

If this review touched locks, CAS, auth-refresh, mutation `finally`, or HTTP mapping of contention/busy: say so in chat and ensure the **bug** axis (`references/bug-review.md` Must-probe) still covers error propagation (typed catch in detached tasks, `finally` not replacing the original error, retryable 409/503, deterministic lock/cleanup tests). Security Pass alone does **not** close that bug coverage.

## Domain heuristics (common ship-loop misses)

- **Provider / preset PRs:** `preserveCustomDestination` (or equivalent); same-name custom provider must not be canonicalized onto a new host; routing auth when catalogs bundle third-party models.
- **Management / dashboard APIs:** authz on `/api/*`; Origin/CORS vs TLS terminators; admin token file ACLs.
- **Proxy / outbound:** private-network defaults vs SSRF; metadata/link-local deny.
- **Windows service / process control:** PID identity verification; no trust of healthz alone.
- **Fail-open production defaults:** findings when prod can run insecurely.
- **Business logic:** checkout/entitlement/state transitions — can a step be skipped or replayed?
- **Removed controls:** prefer `git diff` / scope `removedControlLeads` over reading only added lines.
- **Crypto/session:** prefer vetted libs; reject `alg=none` / hard-coded IV/key; session cookies need Secure/HttpOnly/SameSite in prod paths.
- **IaC/Docker:** no secrets in layers; non-root where possible; no `:latest` silent drift for prod images when the diff pins trust; K8s RBAC least privilege on touched objects.
- **Skill / MCP packages:** run AST01–AST10 (`agentic-skills-top10.md`); watch for prompt-injection in `SKILL.md`, over-broad tool grants, remote instruction fetch, unsigned install scripts.
- **Never auto red-team:** second adversarial pass only on explicit user ask.

## Steps

1. Resolve targets (bare `#N` per shared rules). Checkout when reviewing/fixing a PR.
2. Run **scope script** (PRs) → **Mandatory method** (subagent → AI skill if required → secrets → static/deps → matrix → validate confidence → pass gate).
3. Split output: **full + matrix + scope summary → chat**; **redacted → GitHub** when posting.
4. PR in scope: triage; **fix** necessary/useful High/Critical Confirmed (and useful Medium) in this PR; push; recheck CI. Redacted request-changes / comments only on GitHub.
5. Chat summary: Security decision, risk level, confirmed findings (severity + **confidence**), needs verification, coverage matrix, scope `requiredSurfaces`, residual, fixes + regressions this session, explicit user accepts if any.

## Done when

- Scope script run for PRs (JSON summarized in chat)
- Subagent/skill pass attempted without harness `security-review` / `review-security` (or explicit failure + manual matrix)
- `ai-agent-security` loaded when scope requires it
- Agentic Skills Top 10 matrix done when `requireAgenticSkillsTop10`
- Adversarial/red-team second pass **not** run unless user explicitly asked (and noted if skipped-as-default)
- Deps audit run when scope requires it (or `n/a` with tool missing)
- Secrets scan attempted or `n/a` justified
- Coverage matrix complete for all **required** surfaces (incl. crypto/session, business logic, removed controls, IaC/Docker, agentic skills when flagged)
- Confidence labels applied; Do-Not-Flag respected
- Pass gate satisfied for the stated decision
- User has full exploit/fix detail in chat
- Public posts (if any) redacted + meet `comment-depth.md`
- Necessary in-PR fixes landed or declined / user-accepted with rationale
