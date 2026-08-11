# Automatic Watchdog Activation Implementation Plan

> **Implementation status:** Executed on PR #213. During implementation, official Codex documentation exposed an additional trust boundary: newly configured or changed non-managed hooks are skipped until their exact definition is reviewed/trusted. The approved design spec was updated accordingly. The completed implementation therefore uses `controlled stream > trusted hooks > none`, reports fresh hook configuration as `none / hook_trust_required`, and uses `scripts/codex-with-watchdog.mjs` for in-flight interruption. The detailed original task decomposition below is retained as planning history; the updated spec, code, tests, and exact-head CI are authoritative where discovery changed an interface or filename.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a standard supported Codex install/upgrade automatically activate the strongest watchdog mode it can prove, persist the effective mode, and prove the observed repeated `Let me check...` narration is interrupted in streaming mode before the configured output budget is exceeded.

**Architecture:** Add a small deterministic activation module that selects `stream`, `hooks`, or `none` from explicit capabilities and owns a non-sensitive activation receipt. Integrate that module into `install-skill.mjs`, reusing the existing safe hook installer for hook mode and a stable App Server launcher for stream mode. Runtime capability reporting reads the persisted receipt, while tests cover installation, idempotency, truthful degradation, and the real incident phrase family.

**Tech Stack:** Node.js 22/24, ESM, `node:test`, filesystem primitives, existing Codex hook installer, existing App Server watchdog proxy, GitHub Actions matrix.

## Global Constraints

- Normal install/upgrade must no longer require a second manual watchdog-install command to obtain available protection.
- Mode selection must be strongest verified mode: `stream` > `hooks` > `none`.
- Never select `stream` merely because `codex` exists; require a controllable App Server launch boundary.
- Host configuration writes remain backup-first, fail closed on malformed/symlinked configuration, preserve unrelated hooks, and remain idempotent.
- Activation state must contain no secrets, prompts, raw tool inputs, or conversation content.
- Hook-only mode must explicitly disclose that in-turn narration cannot be interrupted until `Stop`.
- `none` must report `progress_watchdog_unavailable` without making installation itself fail solely for lack of a watchdog surface.
- Existing GitHub mutation authority, freshness, review, security, CI, and final-evidence rules remain unchanged.
- Existing Node 22/24 Ubuntu, macOS, and Windows CI must remain green.

---

### Task 1: Add activation selection and receipt contracts

**Files:**
- Create: `scripts/lib/watchdog-activation.mjs`
- Create: `tests/unit/watchdog-activation.test.mjs`

**Interfaces:**
- Produces: `selectWatchdogMode({ host, streamLaunchControlled, lifecycleHooksSupported }) -> { mode, degradationReason }`
- Produces: `activationReceiptPath({ codexHome }) -> string`
- Produces: `writeActivationReceipt({ codexHome, mode, degradationReason, launcherPath, apply }) -> { path, changed, applied, receipt }`
- Produces: `readActivationReceipt({ codexHome }) -> object | null`

- [x] **Step 1: Write failing selection tests**
- [x] **Step 2: Write failing receipt tests**
- [x] **Step 3: Run the targeted test and verify RED**
- [x] **Step 4: Implement the minimal activation module**
- [x] **Step 5: Run the targeted test and verify GREEN**
- [x] **Step 6: Commit**

### Task 2: Integrate automatic hook activation into the normal installer

**Files:**
- Modify: `scripts/install-skill.mjs`
- Modify: `scripts/install-codex-watchdog-hooks.mjs`
- Modify/add focused installer tests

- [x] **Step 1: Add a failing normal-install regression**
- [x] **Step 2: Add upgrade/idempotency assertions**
- [x] **Step 3: Verify RED before production support**
- [x] **Step 4: Refactor `install-skill.mjs` around reusable orchestration**
- [x] **Step 5: Reuse the existing hook installer**
- [x] **Step 6: Return truthful degradation**
- [x] **Step 7: Verify installer tests GREEN**
- [x] **Step 8: Commit**

Implementation discovery added one stronger invariant: hook configuration is not active hook enforcement until Codex trust is confirmed. The installer therefore reports `hook_trust_required` for a fresh definition and supports a same-version `--hook-trust-verified --apply` activation refresh after `/hooks` review.

### Task 3: Add a stable streaming launcher and select stream only when controllable

**Implemented files:**
- `scripts/codex-with-watchdog.mjs`
- `scripts/lib/codex-watchdog-remote-bridge.mjs`
- `scripts/install-skill.mjs`
- `tests/unit/codex-protected-launcher.test.mjs`
- `tests/unit/codex-watchdog-remote-bridge.test.mjs`

- [x] Protected launcher installed with the skill
- [x] `stream` selected only for a controlled launch boundary
- [x] Real App Server remains stdio
- [x] Authenticated loopback remote bridge interposes streamed deltas
- [x] Caller cannot replace the launcher's remote endpoint flags
- [x] Protected process tree declares `stream`
- [x] Bridge validates upgrade/auth boundaries and bounds malformed/oversized traffic
- [x] Commit

### Task 4: Make runtime capability reporting read installed activation truth

**Files:**
- `scripts/lib/runtime-capabilities.mjs`
- `scripts/runtime-capabilities.mjs`
- `tests/unit/runtime-capabilities-activation.test.mjs`

- [x] Persisted activation is read when no current-runtime declaration exists
- [x] Protected launcher current-session `stream` declaration overrides stale machine state
- [x] Invalid/missing receipt cannot upgrade capability
- [x] Hook degradation is exposed explicitly
- [x] Commit

### Task 5: Add the exact in-turn incident end-to-end regression

**Files:**
- `tests/unit/codex-watchdog-remote-bridge.test.mjs`

- [x] Fixture includes `Let me check the type.`, `Let me check the NOUS_DEF type.`, `Let me check the live test type.`, and `Let me check the OAuthProviderDef type.`
- [x] Deltas flow through the protected streaming boundary
- [x] One private `turn/interrupt` is emitted before 500 characters
- [x] Duplicate interrupt for the same turn is prevented
- [x] Unauthenticated bridge client is rejected

### Task 6: Update operator docs and run repository-wide verification

**Files:**
- `README.md`
- `INSTALL.md`
- `references/agent-progress-watchdog.md`
- `references/runtime-capabilities.md`
- PR #213 body

- [x] Normal install/hook trust flow documented
- [x] `none` / trusted `hooks` / controlled `stream` semantics documented
- [x] Protected stream launcher documented
- [x] Codex App Server/WebSocket experimental maturity disclosed
- [x] Safety invariants and non-sensitive activation receipt documented
- [x] RED evidence retained
- [ ] Exact final-head CI, CodeQL, Architecture Contracts, and Dependency Review green
- [ ] PR #213 marked ready for review after exact-head verification
