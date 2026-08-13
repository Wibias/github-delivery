# Legacy Manifestless Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let genuine pre-manifest GitHub Delivery installations migrate safely through the verified stable update path.

**Architecture:** Add one shared legacy-installation recognizer, expose the state through bootstrap discovery, teach stable update planning to emit `migrate_legacy`, and allow replacement only when that migration plan came from a verified release candidate. Keep setup manifest-only and keep legacy integrity explicitly unknown.

**Tech Stack:** Node.js ESM, `node:test`, existing bootstrap/distribution/release verification modules.

## Global Constraints

- No downgrade during legacy migration.
- No synthetic integrity result for a manifestless installation.
- A migration write is allowed only after the stable release candidate is verified.
- The complete old target must be backed up before replacement.
- Existing managed-installation update semantics must not change.

---

### Task 1: Recognize legacy manifestless installations

**Files:**
- Create: `scripts/lib/legacy-installation.mjs`
- Modify: `scripts/lib/bootstrap-cli.mjs`
- Test: `tests/unit/github-delivery-cli.test.mjs`

**Interfaces:**
- Produces: `inspectLegacyManifestlessInstallation({ target, dependencies? }) -> { version } | null`
- Discovery produces `{ target, valid: false, migratable: true, legacy: true, version, reason: "legacy_manifestless" }` for recognized legacy targets.

- [ ] **Step 1: Write the failing discovery tests**

Add a fixture with `package.json`, `SKILL.md`, and `scripts/install-skill.mjs`, but no `manifest.json`. Assert that discovery returns `legacy_manifestless`. Add an arbitrary manifestless fixture and assert it remains `missing_manifest` for an explicit target.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/unit/github-delivery-cli.test.mjs`
Expected: FAIL because manifestless installations are currently reported only as `missing_manifest` or ignored.

- [ ] **Step 3: Implement the recognizer and discovery classification**

The recognizer must require all identity markers from the design and return only a semantic version. Discovery must not mark the entry as a normal managed installation.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/unit/github-delivery-cli.test.mjs`
Expected: PASS.

### Task 2: Plan and apply verified legacy migration

**Files:**
- Modify: `scripts/lib/stable-release-update.mjs`
- Modify: `scripts/install-skill.mjs`
- Modify: `scripts/lib/distribution.mjs`
- Test: `tests/unit/stable-release-update-security.test.mjs`
- Test: `tests/unit/distribution.test.mjs` or the existing installer-focused unit test that exercises `applyInstallation`

**Interfaces:**
- `planStableUpdate(...)` may return `action: "migrate_legacy"`, `legacyManifestless: true`, `integrityKnown: false`.
- Internal install option: `legacyManifestlessMigration: true`. It is set only by `runInstallCommand` after receiving a verified release candidate whose plan is `migrate_legacy`.

- [ ] **Step 1: Write failing plan tests**

Assert that an older and same-version recognized legacy target returns `migrate_legacy`; a newer legacy target returns `already_ahead`; an unrecognized target still throws `installed_manifest_missing`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/stable-release-update-security.test.mjs`
Expected: FAIL because `planStableUpdate` currently requires `manifest.json`.

- [ ] **Step 3: Implement legacy planning**

On `installed_manifest_missing`, call the shared recognizer. Preserve all existing managed-manifest behavior. Never mark legacy integrity as clean.

- [ ] **Step 4: Write failing apply test**

Create a manifestless legacy target and a same/newer verified source payload. Assert migration is allowed only with the internal legacy migration option, creates a backup, replaces the target, and installs `manifest.json`.

- [ ] **Step 5: Verify RED**

Run the focused installer/distribution test file.
Expected: FAIL because same-version manifestless replacement is currently blocked.

- [ ] **Step 6: Implement minimal migration application**

Teach `planInstallation`/`applyInstallation` to accept `legacyManifestlessMigration: true` only when the target passes the recognizer and the source version is not lower. Reuse the existing backup and rollback-on-copy-failure code.

- [ ] **Step 7: Wire verified update execution**

In `runInstallCommand`, accept `migrate_legacy` as an applyable verified candidate action and pass `legacyManifestlessMigration: true` into `installSkill`. Keep post-install release verification unchanged.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run the two focused test files. Expected: PASS.

### Task 3: Bootstrap selection and doctor UX

**Files:**
- Modify: `scripts/lib/bootstrap-command.mjs`
- Modify: `scripts/lib/bootstrap-maintenance.mjs`
- Modify: `scripts/github-delivery-cli.mjs`
- Test: `tests/unit/bootstrap-maintenance.test.mjs`
- Test: `tests/unit/bootstrap-health-ux.test.mjs`

**Interfaces:**
- `update` can select `valid === true` or `migratable === true` installations.
- `setup` still selects only `valid === true` installations.
- Doctor reports recognized legacy installations as installed but unmanaged/manifestless, with unknown integrity and an update migration action.

- [ ] **Step 1: Write failing bootstrap and doctor tests**

Cover update selection, setup rejection, doctor selection, latest-version relation, and human-readable migration guidance.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/bootstrap-maintenance.test.mjs tests/unit/bootstrap-health-ux.test.mjs`
Expected: FAIL because bootstrap currently filters exclusively on `valid === true`.

- [ ] **Step 3: Implement selection and reporting**

Keep setup strict. Add migratable candidates only to update/doctor selection. Render legacy integrity as unknown and point to `npx github-delivery update --apply`.

- [ ] **Step 4: Verify GREEN**

Run the focused bootstrap tests. Expected: PASS.

### Task 4: Full verification

**Files:**
- No production changes unless a regression is found.

- [ ] **Step 1: Run full repository checks**

Run the repository's normal CI-equivalent test/check command from `package.json`.

- [ ] **Step 2: Verify architecture/package gates**

Run the existing architecture and npm-package validation commands used by CI.

- [ ] **Step 3: Inspect final diff**

Confirm the branch changes only legacy migration logic, tests, and the design/plan documents.

- [ ] **Step 4: Open a draft PR**

PR title: `Support safe upgrades from legacy manifestless installations`

PR body must explain the root cause, identity checks, verified-release requirement, backup behavior, no-downgrade rule, and test evidence.
