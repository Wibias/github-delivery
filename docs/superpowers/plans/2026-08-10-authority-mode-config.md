# Configurable Authority Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows Hello / trusted-authority enforcement globally configurable as `off`, `high-assurance`, or `all`, with a persistent per-user config that defaults to `off` while preserving all existing mutation-policy rules.

**Architecture:** Add a cross-platform user-config module whose canonical file lives outside the installed skill directory. Mutation planning/execution resolves one effective authority mode from legacy strict env, explicit mode env, then the persistent config. Existing high-assurance classification remains unchanged; only whether that classification requires trusted authority becomes configurable. Full-review publication verification follows the same effective mode so `off` has no hidden Windows Hello exception.

**Tech Stack:** Node.js 22/24 ESM, node:test, existing mutation broker and trusted-authority verifier.

## Global Constraints

- User-facing authority modes are exactly `off`, `high-assurance`, and `all`.
- Default mode is `off` when no config exists.
- `off` disables trusted-authority / Windows Hello requirements only; mutation-mode, explicit-instruction, exact-text, expected-head, idempotency, and workflow gates remain enforced.
- `high-assurance` preserves the current behavior: autonomous execution and registry `highAssurance` actions require trusted authority.
- `all` requires trusted authority for every executed GitHub mutation.
- `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` remains supported and maps to `all`.
- `GITHUB_DELIVERY_AUTHORITY_MODE` may override the persistent file for automation/testing.
- Invalid config or invalid explicit env mode fails closed with a clear error.
- The config file must live outside `~/.agents/skills/github-delivery` so skill upgrades cannot overwrite it.

---

### Task 1: Persistent user config

**Files:**
- Create: `scripts/lib/user-config.mjs`
- Create: `tests/unit/user-config.test.mjs`

**Interfaces:**
- Produces: `AUTHORITY_MODES`, `DEFAULT_USER_CONFIG`, `userConfigPath(options)`, `readUserConfig(options)`, `writeUserConfig(config, options)`, `resolveAuthorityMode(options)`.

- [ ] **Step 1: Write failing path/default/validation tests**

```js
assert.equal(userConfigPath({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, home: "C:\\Users\\me" }), "C:\\Users\\me\\AppData\\Local\\github-delivery\\config.json");
assert.equal(readUserConfig({ exists: () => false }).config.authorityMode, "off");
assert.throws(() => normalizeUserConfig({ schemaVersion: 1, authorityMode: "sometimes" }), /github_delivery_config_authority_mode_invalid/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/user-config.test.mjs`
Expected: FAIL because `scripts/lib/user-config.mjs` does not exist.

- [ ] **Step 3: Implement the config module**

Canonical schema:

```json
{
  "schemaVersion": 1,
  "authorityMode": "off"
}
```

Path rules:

```text
Windows: %LOCALAPPDATA%\github-delivery\config.json
macOS:   ~/Library/Application Support/github-delivery/config.json
Linux:   $XDG_CONFIG_HOME/github-delivery/config.json or ~/.config/github-delivery/config.json
```

Write atomically with a sibling temporary file followed by rename. Create the parent directory first. On POSIX, best-effort chmod the finished file to `0600`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/user-config.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/user-config.mjs tests/unit/user-config.test.mjs
git commit -m "feat: add persistent github-delivery config"
```

### Task 2: Effective trusted-authority policy

**Files:**
- Modify: `scripts/lib/mutation-execution-context.mjs`
- Modify: `scripts/lib/mutation-document-execution.mjs`
- Modify: `tests/unit/mutation-execution-context.test.mjs`
- Modify: `tests/unit/mutation-document-execution.test.mjs`

**Interfaces:**
- Consumes: `resolveAuthorityMode()` and `readUserConfig()` from Task 1.
- Produces: `mutationAuthorityOptions(...).authorityMode` and `mutationAuthorityRequired(request, options)` for callers that must decide whether to prompt.

- [ ] **Step 1: Write failing effective-mode tests**

Test these exact behaviors:

```js
// off: high-assurance classification exists but no trusted authority is required.
assert.equal(mutationAuthorityOptions({ request: { action: "merge_pr", mutationMode: "maintainer" }, enforceHighAssurance: true, config: { schemaVersion: 1, authorityMode: "off" } }).requireTrustedAuthority, false);

// high-assurance: preserve current behavior.
assert.equal(mutationAuthorityOptions({ request: { action: "merge_pr", mutationMode: "maintainer" }, enforceHighAssurance: true, config: { schemaVersion: 1, authorityMode: "high-assurance" } }).requireTrustedAuthority, true);

// all: even a non-high-assurance write requires trusted authority.
assert.equal(mutationAuthorityOptions({ request: { action: "draft_text", mutationMode: "read-only" }, enforceHighAssurance: true, config: { schemaVersion: 1, authorityMode: "all" } }).requireTrustedAuthority, true);
```

Add a mutation-document test showing an executed high-assurance request in `off` mode never calls `authorizeBatchSync`, while `high-assurance` still does.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/mutation-execution-context.test.mjs tests/unit/mutation-document-execution.test.mjs`
Expected: FAIL because config-aware effective authority is not implemented.

- [ ] **Step 3: Implement mode resolution at the broker boundary**

Resolution precedence:

```text
GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1 -> all
GITHUB_DELIVERY_AUTHORITY_MODE              -> explicit validated mode
persistent config authorityMode             -> configured mode
missing config                               -> off
```

`mutationRequiresTrustedAuthority(request)` remains the intrinsic classifier for the existing high-assurance/autonomous set. `mutationAuthorityRequired()` applies the selected mode to that classification. `executeMutationDocument()` must use the effective requirement rather than prompting merely because the intrinsic classifier returned true.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/mutation-execution-context.test.mjs tests/unit/mutation-document-execution.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/mutation-execution-context.mjs scripts/lib/mutation-document-execution.mjs tests/unit/mutation-execution-context.test.mjs tests/unit/mutation-document-execution.test.mjs
git commit -m "feat: make trusted authority enforcement configurable"
```

### Task 3: Full-review provenance follows the selected mode

**Files:**
- Modify: `scripts/verify-verdict-published.mjs`
- Test: `tests/unit/verdict-publication.test.mjs` or the existing verdict-provenance test file that owns CLI fixtures.

**Interfaces:**
- Consumes: effective authority mode from Task 1/2.
- Produces: live publication check that requires signed Windows Hello provenance only when the effective mode is not `off`.

- [ ] **Step 1: Write the failing off-mode fixture**

The test must prove that a format-valid verdict owned by the authenticated publisher completes without an authority marker when effective mode is `off`, while `high-assurance` still reports `review_authority_*` for the same comment.

- [ ] **Step 2: Verify RED**

Run the targeted verdict-publication test.
Expected: FAIL because live-style verification always requires authority provenance today.

- [ ] **Step 3: Implement conditional provenance enforcement**

When effective mode is `off`, return provenance shaped like:

```js
{
  valid: true,
  trusted: false,
  authorityMode: "off",
  reason: "trusted_authority_disabled_by_user_config"
}
```

Do not weaken offline security fixtures that explicitly provide an authority public key; those continue to verify the grant.

- [ ] **Step 4: Verify GREEN**

Run targeted verdict tests plus `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-verdict-published.mjs tests/unit
git commit -m "feat: honor authority mode for review provenance"
```

### Task 4: Canonical policy documentation

**Files:**
- Modify: `references/policy/mutation.md`
- Modify: `references/mutation-modes.md`

**Interfaces:**
- Documents the executable semantics from Tasks 1-3.

- [ ] **Step 1: Update policy contracts**

Document the three modes and explicitly state that `off` disables only the independent trusted-authority layer. Keep exact-text human reply confirmation, explicit maintainer instructions, expected-head checks, idempotency, and workflow gates mandatory.

- [ ] **Step 2: Update full-review wording**

Remove unconditional wording that Windows Hello is always required. State that signed durable provenance is required in `high-assurance` and `all`; `off` intentionally has no OS-backed provenance and relies on the normal publication/workflow rules.

- [ ] **Step 3: Run policy/repository checks**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add references/policy/mutation.md references/mutation-modes.md
git commit -m "docs: define configurable authority protection"
```

## Self-Review

- Spec coverage: persistent global config, default off, three modes, env compatibility, runtime prompt behavior, full-review exception removal, and unchanged normal mutation safeguards are all assigned to concrete tasks.
- Placeholder scan: no TBD/TODO/future implementation placeholders are present.
- Type consistency: every consumer uses `authorityMode` with the exact values `off`, `high-assurance`, and `all`.
