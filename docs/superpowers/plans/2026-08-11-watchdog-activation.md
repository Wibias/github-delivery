# Automatic Watchdog Activation Implementation Plan

> **Implementation note:** During execution, the official Codex hook documentation exposed an additional trust boundary: a newly configured or changed non-managed command hook is skipped until its exact definition is reviewed/trusted. The approved design spec was updated accordingly. This plan therefore executes `stream > trusted hooks > none`, with fresh hook configuration reported as `none / hook_trust_required`, and uses the installed `scripts/codex-with-watchdog.mjs` protected remote launcher for in-flight interruption. The detailed task text below records the original implementation decomposition; the updated spec and final code/tests are authoritative where the trust discovery changed an interface or filename.

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

- [ ] **Step 1: Write failing selection tests**

```js
assert.deepEqual(
  selectWatchdogMode({ host: "codex", streamLaunchControlled: true, lifecycleHooksSupported: true }),
  { mode: "stream", degradationReason: null },
);
assert.equal(
  selectWatchdogMode({ host: "codex", streamLaunchControlled: false, lifecycleHooksSupported: true }).mode,
  "hooks",
);
assert.deepEqual(
  selectWatchdogMode({ host: "unknown", streamLaunchControlled: false, lifecycleHooksSupported: false }),
  { mode: "none", degradationReason: "progress_watchdog_unavailable" },
);
```

- [ ] **Step 2: Write failing receipt tests**

Assert dry-run never writes, apply writes only schema/version/mode/degradation/launcher metadata, repeated identical apply is idempotent, malformed existing receipt is replaced only through the activation-owned path, and no prompt/tool/conversation fields exist.

- [ ] **Step 3: Run the targeted test and verify RED**

Run: `node --test tests/unit/watchdog-activation.test.mjs`
Expected: FAIL because `scripts/lib/watchdog-activation.mjs` does not exist.

- [ ] **Step 4: Implement the minimal activation module**

Use explicit booleans only. `stream` requires `host === "codex" && streamLaunchControlled === true`; otherwise `hooks` requires `host === "codex" && lifecycleHooksSupported === true`; otherwise `none`. Store the receipt below Codex home as `github-delivery/watchdog-activation.json` with schema version, mode, degradation reason, launcher path when applicable, and `updatedAt`.

- [ ] **Step 5: Run the targeted test and verify GREEN**

Run: `node --test tests/unit/watchdog-activation.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/watchdog-activation.mjs tests/unit/watchdog-activation.test.mjs
git commit -m "feat: add watchdog activation planner"
```

### Task 2: Integrate automatic hook activation into the normal installer

**Files:**
- Modify: `scripts/install-skill.mjs`
- Modify: `scripts/install-codex-watchdog-hooks.mjs`
- Modify: `tests/unit/installer.test.mjs`
- Modify: `tests/unit/install-codex-watchdog-hooks.test.mjs`

**Interfaces:**
- Consumes: Task 1 `selectWatchdogMode`, `writeActivationReceipt`
- Produces: normal installer result field `watchdog: { mode, degradationReason, receiptPath, hookResult, launcherPath }`
- Refactors: export reusable `defaultHooksPath()` and keep `installCodexWatchdogHooks(...)` semantics unchanged for standalone callers.

- [ ] **Step 1: Add a failing normal-install regression**

Create an isolated temporary Codex home and source/target skill fixture. Invoke `install-skill.mjs` through an exported `installSkill(...)` orchestration function with `host: "codex"`, `streamLaunchControlled: false`, and `lifecycleHooksSupported: true`. Assert apply installs the skill and creates exactly one GitHub Delivery hook entry for each lifecycle event without calling the standalone hook installer.

- [ ] **Step 2: Add failing upgrade/idempotency assertions**

Seed unrelated hooks, run install twice, and assert unrelated semantic content survives and watchdog entries remain exactly one per event.

- [ ] **Step 3: Run targeted installer tests and verify RED**

Run: `node --test tests/unit/installer.test.mjs tests/unit/install-codex-watchdog-hooks.test.mjs`
Expected: FAIL because normal installer does not yet orchestrate activation.

- [ ] **Step 4: Refactor `install-skill.mjs` around `installSkill(options)`**

Keep CLI argument parsing backwards compatible. Add injectable options used by tests and host integrations: `codexHome`, `host`, `streamLaunchControlled`, and `lifecycleHooksSupported`. Default normal behaviour must remain safe when support cannot be proven.

- [ ] **Step 5: Reuse the existing hook installer for selected `hooks` mode**

For `--apply`, install the skill first, then invoke `installCodexWatchdogHooks({ hooksPath, skillDir: target, apply: true })`, then write the activation receipt only after the hook installation succeeds. Dry-run reports the planned hook changes but writes neither target nor hooks nor receipt.

- [ ] **Step 6: Return truthful degradation**

For `hooks`, set a machine-readable degradation reason such as `streaming_interruption_unavailable`; for `none`, set `progress_watchdog_unavailable`. Do not fail skill installation solely because mode is `none`.

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run: `node --test tests/unit/installer.test.mjs tests/unit/install-codex-watchdog-hooks.test.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/install-skill.mjs scripts/install-codex-watchdog-hooks.mjs tests/unit/installer.test.mjs tests/unit/install-codex-watchdog-hooks.test.mjs
git commit -m "feat: activate watchdog during Codex install"
```

### Task 3: Add a stable streaming launcher and select stream only when controllable

**Files:**
- Create: `scripts/lib/watchdog-stream-launcher.mjs`
- Create: `scripts/codex-watchdog-app-server.mjs`
- Modify: `scripts/install-skill.mjs`
- Create: `tests/unit/watchdog-stream-launcher.test.mjs`
- Modify: `tests/unit/codex-watchdog-entrypoints.test.mjs`

**Interfaces:**
- Produces: `installStreamLauncher({ skillDir, launcherPath, apply }) -> { launcherPath, changed, applied }`
- Entry point: `scripts/codex-watchdog-app-server.mjs` delegates to the installed skill's `scripts/codex-app-server-watchdog-proxy.mjs` without changing App Server JSONL semantics.

- [ ] **Step 1: Add failing stream-mode installer tests**

With `streamLaunchControlled: true`, assert the normal installer selects `stream`, creates/plans a stable launcher, records its path in the activation receipt, and does not claim stream when `streamLaunchControlled` is false.

- [ ] **Step 2: Add failing launcher delegation test**

Inject/spawn a fake Codex binary and assert the stable launcher reaches the existing proxy path and preserves command arguments.

- [ ] **Step 3: Run targeted tests and verify RED**

Run: `node --test tests/unit/watchdog-stream-launcher.test.mjs tests/unit/codex-watchdog-entrypoints.test.mjs tests/unit/installer.test.mjs`
Expected: FAIL because the stable launcher does not exist.

- [ ] **Step 4: Implement launcher installation**

Write/update only GitHub Delivery-owned launcher material. Do not rewrite editor or unrelated Codex launch configuration. The caller must explicitly prove that this launch boundary is controlled before `stream` can be selected.

- [ ] **Step 5: Persist stream receipt only after launcher activation succeeds**

If stream launcher activation fails, do not write a `stream` receipt. Fall back to a verified lower mode only when that lower activation succeeds; otherwise record `none` with a concrete degradation reason.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run the same test command as Step 3 and expect PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/watchdog-stream-launcher.mjs scripts/codex-watchdog-app-server.mjs scripts/install-skill.mjs tests/unit/watchdog-stream-launcher.test.mjs tests/unit/codex-watchdog-entrypoints.test.mjs tests/unit/installer.test.mjs
git commit -m "feat: add verified streaming watchdog launcher"
```

### Task 4: Make runtime capability reporting read installed activation truth

**Files:**
- Modify: `scripts/lib/runtime-capabilities.mjs`
- Modify: `scripts/runtime-capabilities.mjs`
- Modify: `tests/unit/runtime-capabilities.test.mjs`

**Interfaces:**
- Consumes: Task 1 `readActivationReceipt({ codexHome })`
- Produces: `buildRuntimeCapabilities({ ..., activation })` where persisted activation is preferred over an absent declaration, while explicit test/operator declaration may override for controlled fixtures.

- [ ] **Step 1: Write failing persisted-mode tests**

Assert a persisted `stream` receipt yields `runtime.progressWatchdog === "stream"` without `SHIPPING_GITHUB_PROGRESS_WATCHDOG`; persisted `hooks` yields `hooks`; missing receipt yields `none`; explicit declaration remains usable for controlled fixtures.

- [ ] **Step 2: Run targeted test and verify RED**

Run: `node --test tests/unit/runtime-capabilities.test.mjs`
Expected: FAIL because runtime capability code does not consume persisted activation.

- [ ] **Step 3: Implement receipt-aware capability resolution**

Resolve mode from explicit declaration when present, otherwise from a validated activation receipt, otherwise `none`. Invalid receipt content must never upgrade capability.

- [ ] **Step 4: Run targeted test and verify GREEN**

Run: `node --test tests/unit/runtime-capabilities.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/runtime-capabilities.mjs scripts/runtime-capabilities.mjs tests/unit/runtime-capabilities.test.mjs
git commit -m "feat: report installed watchdog capability"
```

### Task 5: Add the exact in-turn incident end-to-end regression

**Files:**
- Modify: `tests/unit/agent-progress-watchdog.test.mjs`
- Modify: `tests/unit/codex-watchdog-entrypoints.test.mjs`
- Modify: `tests/unit/installer.test.mjs`

**Interfaces:**
- Consumes: existing `createAppServerWatchdogRouter()` and Task 3 installed streaming entry point.
- Produces: regression proving one private `turn/interrupt` is emitted before the configured character budget for the observed phrase family.

- [ ] **Step 1: Add incident fixture text**

Use variants from the observed failure, including `Let me check the type.`, `Let me check the NOUS_DEF type.`, `Let me check the live test type.`, and `Let me check the OAuthProviderDef type.` Feed them as realistic incremental `item/agentMessage/delta` messages.

- [ ] **Step 2: Assert bounded interruption**

Track emitted assistant characters and assert the first private `turn/interrupt` appears before the watchdog's configured incident budget is exceeded and appears exactly once for the turn.

- [ ] **Step 3: Prove normal install reaches that boundary**

Use the installed stream launcher fixture from Task 3 rather than constructing the router directly for the integration assertion. This proves activation, not merely detection.

- [ ] **Step 4: Run the incident tests**

Run: `node --test tests/unit/agent-progress-watchdog.test.mjs tests/unit/codex-watchdog-entrypoints.test.mjs tests/unit/installer.test.mjs`
Expected: PASS with the exact trace family bounded.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/agent-progress-watchdog.test.mjs tests/unit/codex-watchdog-entrypoints.test.mjs tests/unit/installer.test.mjs
git commit -m "test: prove installed watchdog stops narration stalls"
```

### Task 6: Update operator docs and run repository-wide verification

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `references/agent-progress-watchdog.md`
- Modify: `references/runtime-capabilities.md`
- Modify: PR #213 body

**Interfaces:**
- Documents: normal install activation, actual `stream`/`hooks`/`none` truth, hook-only limitation, standalone installer as recovery/manual path, and controlled stream-boundary requirement.

- [ ] **Step 1: Update installation docs**

Remove wording that makes the standalone hook installer a normal required second step. Keep it documented as manual recovery/repair. Explain that the normal installer activates the strongest verified mode and reports degradation honestly.

- [ ] **Step 2: Update runtime docs**

Document persisted activation receipt semantics and that `stream` is claimed only when a controllable App Server launch boundary is installed/selected.

- [ ] **Step 3: Run targeted watchdog/installer tests**

Run:

```bash
node --test tests/unit/watchdog-activation.test.mjs tests/unit/watchdog-stream-launcher.test.mjs tests/unit/install-codex-watchdog-hooks.test.mjs tests/unit/installer.test.mjs tests/unit/runtime-capabilities.test.mjs tests/unit/agent-progress-watchdog.test.mjs tests/unit/codex-watchdog-entrypoints.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run aggregate repository verification**

Run: `npm run check`
Expected: PASS, including syntax, policy validation, pre-open self-test, repository security, reproducible distribution, offline evals, and unit suite.

- [ ] **Step 5: Verify current-head CI**

Require CI, CodeQL, Architecture Contracts, and Dependency Review to pass on the exact final PR head across the repository's required matrix.

- [ ] **Step 6: Update PR #213 from design draft to implementation-ready summary**

Record RED evidence, implemented activation semantics, exact incident regression, safety invariants, and current-head verification. Mark ready for review only after exact-head required checks are green.

- [ ] **Step 7: Commit documentation**

```bash
git add README.md INSTALL.md references/agent-progress-watchdog.md references/runtime-capabilities.md
git commit -m "docs: explain automatic watchdog activation"
```
