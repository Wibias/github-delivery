# Turn-Scoped Progress Watchdog Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GitHub Delivery watchdog detect both pure narration loops and long read-exploration spirals without cross-turn contamination or false claims about unsupported Codex surfaces.

**Architecture:** Replace generic external-progress resets with a typed turn-scoped progress model. Trusted hooks enforce deterministic local tool-boundary read budgets; controlled App Server streaming owns the hard in-flight interruption boundary and fails closed if required notification or interrupt semantics are unavailable.

**Tech Stack:** Node.js ESM, `node:test`, Codex lifecycle hook JSON protocol, Codex App Server JSON-RPC over the existing authenticated loopback WebSocket bridge, GitHub Actions CI.

## Global Constraints

- Hard in-flight interruption is guaranteed only for the controlled App Server stream.
- Trusted hook mode is a deterministic supported-tool guardrail, not a universal Codex interrupt boundary.
- Hosted tools such as WebSearch are stream-visible but are not assumed to pass through local lifecycle hooks.
- App Server/WebSocket remains experimental and must be documented truthfully.
- No watchdog state may persist prompts, assistant text, raw tool inputs, tool outputs, bearer tokens, or repository secrets.
- Existing GitHub mutation authority, freshness, review, security, and final-evidence gates must remain unchanged.
- Production changes follow RED -> GREEN -> REFACTOR TDD. The exact test-only head must fail for the intended missing behaviour before production code is added.

---

### Task 1: Shared progress classification and budget semantics

**Files:**
- Create: `scripts/lib/watchdog-progress-classifier.mjs`
- Modify: `scripts/lib/agent-progress-watchdog.mjs`
- Test: `tests/unit/watchdog-progress-model.test.mjs`

**Interfaces:**
- Produces `classifyHookTool(input)` and `classifyAppServerItem(item)` returning `evidence | execution | state-change | delegate | neutral`.
- Extends `createProgressWatchdog(options)` with `chargeEvidenceAttempt()`, `recordExecutionProgress()`, `recordStateProgress()`, and `snapshot()` while retaining duplicate-read and narration APIs.

- [ ] **Step 1: Write failing tests** for evidence not resetting narration, soft warning at 8, hard denial at 12, execution resetting only the evidence streak, state progress resetting the streak and invalidating stable-read fingerprints, and unknown tools remaining neutral.
- [ ] **Step 2: Run the test-only head in CI and verify RED** because the new module/APIs do not exist.
- [ ] **Step 3: Implement minimal classifier and typed progress methods.** Charge evidence before execution; only execution/state progress may reset narration; only state progress increments generation and invalidates stable read fingerprints.
- [ ] **Step 4: Verify targeted tests GREEN.**
- [ ] **Step 5: Commit.**

### Task 2: Turn-scoped hook persistence and hook enforcement

**Files:**
- Create: `scripts/lib/watchdog-state-store.mjs`
- Modify: `scripts/codex-watchdog-hook.mjs`
- Modify: `scripts/lib/codex-watchdog-hook.mjs`
- Test: `tests/unit/codex-watchdog-turn-state.test.mjs`
- Test: `tests/unit/codex-watchdog-hook.test.mjs`

**Interfaces:**
- Produces `watchdogStateScope(input)` and `withWatchdogState(scope, reducer, options)`.
- Hook state scope is `session_id + turn_id + agent_id-or-main`; `SessionEnd` removes the whole session directory.

- [ ] **Step 1: Write failing tests** proving two turn IDs under the same session do not share evidence budget, two agent IDs do not share state, SessionEnd removes all turn state, parallel updates do not lose counters, stale locks recover, fresh locks are respected, malformed state fails explicitly, and persisted JSON contains only counters/hashes.
- [ ] **Step 2: Verify RED in CI.**
- [ ] **Step 3: Implement the state store** with exclusive per-turn lock files, bounded acquisition, stale-lock recovery, restrictive permissions, atomic temp-file replacement, and explicit malformed-state errors.
- [ ] **Step 4: Change PreToolUse** to classify/charge evidence before the tool executes, preserve exact duplicate/poll denial, emit one concise soft warning at the configured threshold, and deny further confidently classified evidence at the hard threshold.
- [ ] **Step 5: Change PostToolUse** to record typed execution/state progress only on supported successful completions; never call a generic reset for every tool completion.
- [ ] **Step 6: Keep Stop/SubagentStop recovery bounded** and independent of any claim that emitted tokens were reclaimed.
- [ ] **Step 7: Verify targeted hook/state tests GREEN.**
- [ ] **Step 8: Commit.**

### Task 3: Per-turn App Server routing and incident regressions

**Files:**
- Modify: `scripts/lib/codex-progress-watchdog.mjs`
- Modify: `scripts/lib/codex-app-server-watchdog-proxy.mjs`
- Test: `tests/unit/agent-progress-watchdog.test.mjs`
- Test: `tests/unit/codex-watchdog-remote-bridge.test.mjs`
- Test: `tests/unit/codex-watchdog-turn-routing.test.mjs`

**Interfaces:**
- App Server router owns one watchdog per `turnId`, binds/validates `threadId` when scoped item events arrive, and deletes the turn state on `turn/completed`.
- Evidence attempts are charged on `item/started`; successful execution/state progress is recorded on `item/completed`.

- [ ] **Step 1: Write failing regressions** replaying `Let me read request-log.test.ts.` and requiring one interrupt before 500 emitted characters.
- [ ] **Step 2: Write failing interleaved-exploration regression** with distinct reads/searches between narration fragments and require evidence activity not to reset narration plus hard bounded exploration in stream mode.
- [ ] **Step 3: Write failing concurrent-turn test** proving activity in turn B cannot reset turn A.
- [ ] **Step 4: Verify RED in CI.**
- [ ] **Step 5: Implement per-turn routing and typed item classification.** `webSearch`/`imageView` are evidence; `fileChange` completion is state progress; commands/MCP/dynamic tools use the shared classifier; unknown items are neutral.
- [ ] **Step 6: Verify targeted routing/incident tests GREEN.**
- [ ] **Step 7: Commit.**

### Task 4: Fail-closed protected stream contract

**Files:**
- Modify: `scripts/lib/codex-watchdog-remote-bridge.mjs`
- Modify: `scripts/codex-with-watchdog.mjs`
- Test: `tests/unit/codex-watchdog-remote-bridge.test.mjs`
- Test: `tests/unit/codex-protected-launcher.test.mjs`

**Interfaces:**
- Required notifications: `item/agentMessage/delta`, `item/started`, `item/completed`, `turn/started`, `turn/completed`.
- Protected bridge exposes an internal failure callback/promise consumed by the launcher so watchdog-contract failure terminates the protected process tree.

- [ ] **Step 1: Write failing tests** for initialize opt-out rejection, non-empty completed agent message without observed deltas, interrupt error acknowledgement, interrupt timeout, and one-client/auth/frame protections remaining intact.
- [ ] **Step 2: Verify RED in CI.**
- [ ] **Step 3: Inspect client `initialize` requests** and fail closed if a required notification is opted out.
- [ ] **Step 4: Track agent-message delta visibility** and fail closed when a non-empty completed message is observed without delta coverage.
- [ ] **Step 5: Track private `turn/interrupt` requests** until acknowledgement; hide successful internal responses, surface error responses, and enforce a bounded timeout.
- [ ] **Step 6: Wire bridge failure to launcher cleanup/termination** so the process cannot continue while claiming `stream` protection.
- [ ] **Step 7: Verify targeted bridge/launcher tests GREEN.**
- [ ] **Step 8: Commit.**

### Task 5: Documentation and runtime truth

**Files:**
- Modify: `references/agent-progress-watchdog.md`
- Modify: `references/runtime-capabilities.md`
- Modify: `INSTALL.md`
- Modify: `README.md` only if needed to keep public guarantee wording accurate.
- Modify: `docs/superpowers/specs/2026-08-11-turn-progress-watchdog-hardening-design.md` only for implementation-discovered corrections.

- [ ] **Step 1: Add/adjust documentation contract tests if existing doc assertions require it.**
- [ ] **Step 2: Document typed progress, per-turn state, 8/12 evidence defaults, exact hook limitations, and controlled stream fail-closed semantics.**
- [ ] **Step 3: Ensure no docs imply hosted WebSearch is covered by local hooks or that experimental App Server/WebSocket is a production-stable universal guarantee.**
- [ ] **Step 4: Run documentation/contract tests GREEN.**
- [ ] **Step 5: Commit.**

### Task 6: Final verification and PR readiness

**Files:**
- Update PR #217 body with implementation and exact verification evidence.

- [ ] **Step 1: Run all targeted watchdog/hook/bridge tests on the final head.**
- [ ] **Step 2: Run/observe `npm run check` on the exact final head across the repository CI matrix.**
- [ ] **Step 3: Verify Architecture Contracts, CodeQL, Dependency Review, distribution/reproducibility and security checks on the exact final head.**
- [ ] **Step 4: Inspect failed logs if any and fix via a new RED/GREEN cycle rather than weakening tests.**
- [ ] **Step 5: Review the final PR diff for scope, secrets, accidental generated files, authority changes, and misleading safety claims.**
- [ ] **Step 6: Update PR #217 from design-only wording to implementation summary with exact-head verification evidence.**
- [ ] **Step 7: Mark the PR ready for review only after the final exact head is green.**
