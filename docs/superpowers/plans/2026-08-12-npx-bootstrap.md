# npx Bootstrap and Guided Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npx github-delivery` the zero-clone guided install/setup entrypoint while keeping verified GitHub Releases as the only installed payload source and the existing installer/update machinery as the only mutation boundary.

**Architecture:** Publish a thin, dependency-free npm CLI that orchestrates the existing release verifier, installer, hook/watchdog activation, and update path. Refactor release verification into a reusable acquisition primitive for fresh installs, then layer guided install, setup, doctor, and explicit update commands over the current modules. npm Trusted Publishing is added to the protected tag release workflow, but npm never becomes an alternate skill payload source.

**Tech Stack:** Node.js 22/24 ESM, built-in `readline`, `child_process`, `fs`, `os`, `path`, existing GitHub Release verification/ZIP modules, `node:test`, npm package metadata/pack, GitHub Actions OIDC trusted publishing.

## Global Constraints

- Public commands are `npx github-delivery`, `install`, `setup`, `update`, `update --apply`, and `doctor`.
- Bare `npx github-delivery` launches guided onboarding.
- No v1 `uninstall` command and no v1 `--yes` bypass.
- The npm package is a bootstrap only. It never copies itself into the skill target as the authoritative installed payload.
- Fresh install and update use the same fixed-upstream GitHub Release verification chain.
- The installed payload comes only from the latest published non-draft, non-prerelease `Wibias/github-delivery` release with a strict `vX.Y.Z` tag.
- Existing checksum, manifest, tag/source-commit, attestation, strict ZIP, local-modification, backup, hook-trust, watchdog, and post-install contracts remain authoritative.
- `update` is dry-run by default. `update --apply` is the only npx update replacement path.
- `setup` never replaces the skill payload and never uses the ephemeral npm package as the installed skill source.
- `doctor` is read-only with respect to the installation and credentials.
- Confirmation defaults to No and no install mutation happens before a shown dry-run plan is accepted.
- npm publication uses the same semantic version as `package.json`, the GitHub tag, and release manifest.
- Production behavior changes follow RED -> GREEN TDD. In this environment GitHub Actions on the draft PR is the executable test runner because a local Git checkout is unavailable.
- README changes happen only after implementation behavior is green.

---

### Task 1: Split verified release acquisition from update planning

**Files:**
- Modify: `tests/unit/release-self-update-orchestration.test.mjs`
- Modify: `scripts/lib/release-self-update.mjs`

**Interfaces:**
- Produces: `acquireVerifiedReleasePayload({ workspace, client?, attestationRunner?, dependencies? }) -> Promise<{ schemaVersion: 1, kind: "github-delivery/verified-release-payload", verified: true, source, manifest, release }>`.
- Preserves: `prepareVerifiedReleaseCandidate({ target, workspace, ... })`, now implemented as acquisition followed by `planStableUpdate`.
- `release` remains `{ tag, version, sourceCommit }`.

- [ ] **Step 1: Add a failing acquisition test.**

Add a test that imports `acquireVerifiedReleasePayload` and calls it without `target`. The injected extractor returns a known `source`; the injected `planStableUpdate` throws if called.

```js
const result = await acquireVerifiedReleasePayload({
  workspace,
  client: fakeClient(value, events),
  attestationRunner: () => ({ status: 0, stdout: "", stderr: "" }),
  dependencies: {
    extractVerifiedReleaseZip() {
      events.push("extract");
      return { root: source };
    },
    planStableUpdate() {
      throw new Error("acquisition must not plan");
    },
  },
});
assert.equal(result.verified, true);
assert.equal(result.source, source);
assert.equal(events.at(-1), "extract");
```

- [ ] **Step 2: Add a failing reuse test.**

Inject `acquireVerifiedReleasePayload` into `prepareVerifiedReleaseCandidate` and assert update planning receives its verified release plus the requested installed target exactly once.

- [ ] **Step 3: Commit tests-only RED and verify PR CI fails for the missing export/behavior.**

Expected failure: `acquireVerifiedReleasePayload` is not exported.

- [ ] **Step 4: Extract the existing download/verification/extraction body into `acquireVerifiedReleasePayload`.**

The function must require `workspace` but not `target`. Keep verification order unchanged:

```text
release metadata -> assets -> downloads -> asset digests -> SHA256SUMS
-> manifest -> tag/source commit -> attestation -> strict ZIP extraction
```

Return only verified release metadata, manifest, and extracted source.

- [ ] **Step 5: Make `prepareVerifiedReleaseCandidate` delegate.**

```js
const payload = await acquire({ workspace, client, attestationRunner, dependencies });
const plan = plan({ releases: [payload.rawRelease], target });
return { ...payload, kind: "github-delivery/verified-release-candidate", plan };
```

If raw GitHub release metadata is needed by `planStableUpdate`, keep it as an internal/non-public field or return it explicitly as `releaseMetadata`; do not reconstruct a fake Release object.

- [ ] **Step 6: Verify GREEN.**

Run in CI: `npm test` through `npm run check`; targeted command when a runner is available:

```bash
node --test tests/unit/release-self-update-orchestration.test.mjs
```

- [ ] **Step 7: Commit.**

```text
feat: share verified release acquisition
```

### Task 2: Add bootstrap CLI parsing, environment checks, and installation discovery

**Files:**
- Create: `tests/unit/github-delivery-cli.test.mjs`
- Create: `scripts/lib/bootstrap-cli.mjs`
- Create: `scripts/github-delivery-cli.mjs`

**Interfaces:**
- `parseBootstrapArgs(argv) -> { command, apply, target }`.
- `checkBootstrapEnvironment({ spawn?, nodeVersion? }) -> { node, git, gh, ghAuth, ok }`.
- `discoverInstallations({ home?, explicitTarget?, exists?, readFile? }) -> Array<{ target, valid, version?, reason? }>`.
- `runBootstrap(argv, dependencies?)` dispatches bare/install/setup/update/doctor.

- [ ] **Step 1: Write RED parser tests.**

Require:

```js
assert.deepEqual(parseBootstrapArgs([]), { command: "guided", apply: false, target: null });
assert.equal(parseBootstrapArgs(["install"]).command, "install");
assert.equal(parseBootstrapArgs(["setup"]).command, "setup");
assert.deepEqual(parseBootstrapArgs(["update", "--apply"]), { command: "update", apply: true, target: null });
assert.equal(parseBootstrapArgs(["doctor"]).command, "doctor");
assert.throws(() => parseBootstrapArgs(["uninstall"]), /bootstrap_command_unknown/);
assert.throws(() => parseBootstrapArgs(["install", "--yes"]), /bootstrap_option_unknown/);
```

Allow `--target PATH` for explicit install/update/setup/doctor targeting. Reject `--apply` outside update.

- [ ] **Step 2: Write RED discovery tests.**

Candidate paths:

```text
~/.agents/skills/github-delivery
~/.codex/skills/github-delivery
~/.claude/skills/github-delivery
~/.cursor/skills/github-delivery
```

A valid candidate requires `manifest.json` with schema/kind/name/version matching a github-delivery distribution manifest. Deduplicate equivalent resolved paths. An explicit target is the only candidate when supplied.

- [ ] **Step 3: Write RED environment tests.**

Node supports major 22 or 24 only. `git --version`, `gh --version`, and `gh auth status` are probed without modifying credentials. Return actionable status; do not call `gh auth login`.

- [ ] **Step 4: Commit tests-only RED and confirm missing module failure.**

- [ ] **Step 5: Implement minimal parser/discovery/environment modules using Node built-ins only.**

The executable should be a thin wrapper:

```js
#!/usr/bin/env node
import { runBootstrap } from "./lib/bootstrap-cli.mjs";

runBootstrap(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Verify GREEN.**

```bash
node --test tests/unit/github-delivery-cli.test.mjs
node scripts/github-delivery-cli.mjs --help
```

`--help` may be added as a non-mutating usability flag even though it is not a workflow command; its text must list only supported commands/options.

- [ ] **Step 7: Commit.**

```text
feat: add github-delivery bootstrap cli
```

### Task 3: Implement verified guided fresh install

**Files:**
- Create: `scripts/lib/bootstrap-install.mjs`
- Create: `tests/unit/bootstrap-install.test.mjs`
- Modify: `scripts/install-skill.mjs` only to export one existing post-install verifier if needed; do not duplicate it.
- Modify: `scripts/lib/bootstrap-cli.mjs`

**Interfaces:**
- `runGuidedInstall({ target, host, input?, output?, dependencies? }) -> Promise<result>`.
- `confirmApply(question, { input, output }) -> Promise<boolean>` defaults false for blank/EOF/non-yes.
- Reuse `acquireVerifiedReleasePayload`, `installSkill`, `readUserConfig`, and the canonical installed-release verifier.

- [ ] **Step 1: Write RED test that acquisition happens before installer planning.**

Inject a verified payload and assert `installSkill` receives:

```js
{
  source: verified.source,
  target,
  apply: false,
  update: false,
  allowDowngrade: false,
  force: false
}
```

plus host/codex options generated by the bootstrap.

- [ ] **Step 2: Write RED cancellation test.**

The dry-run is shown, confirmation returns false, `apply:true` is never called, temporary workspace cleanup always occurs, and persistent config is unchanged.

- [ ] **Step 3: Write RED accepted-install/postcondition test.**

After confirmation, invoke the same installer with the same verified `source` and `apply:true`. Require installed manifest/file verification and compare `readUserConfig()` before/after. Any unexpected config change fails closed and surfaces any installer backup path.

- [ ] **Step 4: Write RED existing-install guard.**

Explicit `install` on an already valid installation returns/throws an actionable `bootstrap_install_existing` result instead of silently treating it as an upgrade. Bare guided invocation routes existing installs to the existing-install menu in Task 4.

- [ ] **Step 5: Commit tests-only RED and verify intended failure.**

- [ ] **Step 6: Implement temporary workspace lifecycle and confirmation.**

Use `mkdtempSync(join(tmpdir(), "github-delivery-bootstrap-"))`; cleanup in `finally`. Verification downloads may happen before confirmation, but target mutation may not.

- [ ] **Step 7: Implement apply/postcondition path through existing installer only.**

Do not call `cpSync`, `renameSync`, hook mutation APIs, or activation receipt writes directly from bootstrap install.

- [ ] **Step 8: Verify GREEN and commit.**

```bash
node --test tests/unit/bootstrap-install.test.mjs tests/unit/github-delivery-cli.test.mjs
```

Commit:

```text
feat: add verified guided install
```

### Task 4: Implement explicit update, repair setup, doctor, and bare guided routing

**Files:**
- Create: `scripts/lib/bootstrap-maintenance.mjs`
- Create: `tests/unit/bootstrap-maintenance.test.mjs`
- Modify: `scripts/lib/bootstrap-cli.mjs`
- Modify: `tests/unit/github-delivery-cli.test.mjs`

**Interfaces:**
- `runBootstrapUpdate({ target, apply, dependencies? })` calls shared installer update mode with explicit target.
- `runBootstrapSetup({ target, input?, output?, dependencies? })` inspects/refreshes activation only.
- `runBootstrapDoctor({ target?, dependencies? })` returns read-only diagnostic report.
- `runGuidedExisting(...)` presents Update / Repair setup / Exit and performs only the selected operation.

- [ ] **Step 1: Write RED update-delegation test.**

Assert npm bootstrap creates update options equivalent to:

```js
parseInstallArgs(["--update", "--target", target, ...(apply ? ["--apply"] : [])])
```

and passes them to `runInstallCommand`. The target must be explicit so the ephemeral npm package root can never become the update target.

- [ ] **Step 2: Write RED setup tests.**

Cases:
- no valid installation -> `bootstrap_setup_installation_missing`;
- receipt/hook state healthy -> no mutation;
- hooks configured but trust not verified -> show `/hooks` guidance and do not bypass;
- after explicit user confirmation that the exact hooks were reviewed/trusted, load the **installed** `target/scripts/install-skill.mjs` and execute same-version activation refresh with installed source/target and `hookTrustVerified:true`;
- hook dry-run says definition would change -> remain `hook_trust_required`, never assert trust.

- [ ] **Step 3: Write RED doctor tests.**

Doctor reports Node/Git/gh/auth, valid installation/version, manifest drift, config readability, activation receipt/watchdog state, latest release version, and `update|already_current|already_ahead` version relation. It must never call installer apply, hook apply, config write, or auth mutation.

- [ ] **Step 4: Write RED bare-guided routing tests.**

No valid install -> fresh install flow. One valid install -> Update / Repair setup / Exit. Multiple valid installs -> target selection required before action. Invalid occupied path -> actionable conflict.

- [ ] **Step 5: Commit tests-only RED and verify.**

- [ ] **Step 6: Implement update delegation and installed-module setup loading.**

Use `pathToFileURL(join(target, "scripts", "install-skill.mjs")).href` for the setup activation refresh. Never import the npm package's own installer as proof of the installed source.

- [ ] **Step 7: Implement doctor with read-only helpers.**

Use `readInstalledManifest`, `compareInstalledManifest`, `readUserConfig`, `readActivationReceipt`, and latest release metadata. Do not download/apply a release merely to report availability.

- [ ] **Step 8: Implement terminal menu/prompt helpers with built-in `readline`.**

Blank/EOF cancels. No automatic update selection.

- [ ] **Step 9: Verify GREEN and commit.**

```bash
node --test tests/unit/bootstrap-maintenance.test.mjs tests/unit/github-delivery-cli.test.mjs
```

Commit:

```text
feat: add npx setup update and doctor
```

### Task 5: Make the repository a minimal publishable npm CLI package

**Files:**
- Modify: `package.json`
- Create: `scripts/validate-npm-package.mjs`
- Create: `tests/unit/npm-package.test.mjs`

**Interfaces:**
- Package name remains exactly `github-delivery`.
- `bin.github-delivery = "./scripts/github-delivery-cli.mjs"`.
- `npm run package:check` validates package metadata and `npm pack --dry-run --json --ignore-scripts` contents.

- [ ] **Step 1: Write RED package metadata tests.**

Require:

```js
assert.equal(pkg.private, undefined);
assert.equal(pkg.bin["github-delivery"], "./scripts/github-delivery-cli.mjs");
assert.equal(pkg.license, "MIT");
assert.equal(pkg.repository.url, "https://github.com/Wibias/github-delivery.git");
assert.equal(pkg.publishConfig.access, "public");
for (const key of ["preinstall", "install", "postinstall"]) assert.equal(pkg.scripts?.[key], undefined);
```

Require no runtime `dependencies` unless a later implementation change is explicitly justified.

- [ ] **Step 2: Write RED pack allowlist test.**

The packed bootstrap may include only package metadata/docs automatically included by npm plus the explicit bootstrap runtime paths needed to execute:

```text
scripts/github-delivery-cli.mjs
scripts/install-skill.mjs
scripts/install-codex-watchdog-hooks.mjs
scripts/lib/** required by those modules
```

An npm tarball may contain README/LICENSE/package.json automatically; validate that it does not accidentally include tests, authority-host binaries, release archives, `.github`, docs/superpowers, or unrelated workflow scripts.

- [ ] **Step 3: Commit tests-only RED and verify metadata failure.**

- [ ] **Step 4: Update package metadata and explicit `files` allowlist.**

Add description, license, repository, homepage/bugs if useful, `bin`, `files`, and `publishConfig`. Remove `private:true`. Keep `type:module`, version, and `engines` unchanged.

- [ ] **Step 5: Implement package validator and wire it into `npm run check`.**

The validator must fail on unexpected packed paths or missing CLI/runtime paths and must run with scripts disabled.

- [ ] **Step 6: Verify isolated execution.**

Use a test that creates an actual package tarball in a temporary directory, extracts/installs it without a repository checkout, and runs:

```bash
node <packed-root>/scripts/github-delivery-cli.mjs --help
```

No network operation is required for `--help`.

- [ ] **Step 7: Commit.**

```text
feat: package github-delivery for npx
```

### Task 6: Integrate npm Trusted Publishing into the protected release workflow

**Files:**
- Modify: `.github/workflows/release.yml`
- Create: `tests/unit/npm-release-workflow.test.mjs`

**Interfaces:**
- npm publish occurs only in the existing tag-only `publish` job using environment `release`.
- Publish job keeps `id-token: write` and uses npm registry setup.
- No `NPM_TOKEN`/`NODE_AUTH_TOKEN` secret is introduced for publication.
- Package/tag/release version equality remains enforced by existing release context validation plus package checks.

- [ ] **Step 1: Write RED workflow contract test.**

Read `.github/workflows/release.yml` as text and require all of:

```text
environment: release
id-token: write
registry-url: https://registry.npmjs.org
npm install --global npm@11.5.1
npm publish --access public
```

Reject `NPM_TOKEN` and `NODE_AUTH_TOKEN` in the trusted-publish step. Require npm publication to be inside the tag-only publish job, not PR/branch jobs.

- [ ] **Step 2: Commit tests-only RED and verify failure.**

- [ ] **Step 3: Update release workflow.**

Set `registry-url` on the publish job's `actions/setup-node` step. Before publication, run package validation from the tagged commit. Install/pin an npm CLI version that meets the trusted publishing minimum, then run:

```bash
npm publish --access public
```

Do not pass `--provenance`; trusted publishing supplies provenance automatically for the supported public GitHub context.

- [ ] **Step 4: Keep release ordering fail-visible.**

The workflow must fail if npm publication fails. Do not catch/ignore `npm publish` failure or mark the overall release complete when it failed.

- [ ] **Step 5: Verify workflow tests + repository security validation GREEN.**

```bash
node --test tests/unit/npm-release-workflow.test.mjs
npm run security:repo
```

- [ ] **Step 6: Commit.**

```text
ci: publish github-delivery with npm oidc
```

### Task 7: Update docs only after implementation is green, then exact-head verification

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `references/update.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-12-npx-bootstrap-design.md`
- Modify: this plan's checkbox/status text only if the repository convention records completion.

**Interfaces:**
- README primary install: `npx github-delivery`.
- Common update: `npx github-delivery update` / `--apply`.
- Direct `node scripts/install-skill.mjs...` commands remain documented as advanced/local fallback.
- Docs must not claim the npm package is published until a real npm publish has actually happened.

- [ ] **Step 1: Confirm all implementation tests are GREEN before touching README.**

Required targeted suites:

```bash
node --test \
  tests/unit/release-self-update-orchestration.test.mjs \
  tests/unit/github-delivery-cli.test.mjs \
  tests/unit/bootstrap-install.test.mjs \
  tests/unit/bootstrap-maintenance.test.mjs \
  tests/unit/npm-package.test.mjs \
  tests/unit/npm-release-workflow.test.mjs
```

- [ ] **Step 2: Update README quick start.**

Lead with:

```bash
npx github-delivery
```

Then briefly show explicit `install`, `setup`, `doctor`, `update`, and `update --apply`. Preserve the natural-language usage story. Move clone/build/manual scripts to advanced installation rather than deleting them.

- [ ] **Step 3: Update INSTALL/update workflow/changelog.**

Document guided setup, confirmation behavior, GitHub Release trust chain, explicit installed-target update semantics, setup hook trust flow, doctor diagnostics, advanced script fallback, and npm Trusted Publisher repository prerequisite.

- [ ] **Step 4: Mark spec implemented only after exact behavior matches it.**

- [ ] **Step 5: Commit docs.**

```text
docs: add npx install setup and update
```

- [ ] **Step 6: Run full exact-head verification through the draft PR.**

Require successful final-head runs for:
- Node 22/24 on Ubuntu, Windows, macOS;
- Architecture Contracts when triggered;
- Dependency Review;
- CodeQL JavaScript/TypeScript;
- CodeQL C#;
- all `npm run check` package/release contract tests.

- [ ] **Step 7: Review the final PR diff for scope and security.**

Confirm no second payload installer/downloader, no auth mutation, no `--yes`, no uninstall, no direct bootstrap copy into target, no hook-trust bypass, no npm token secret, and no release/version bump or publish performed by this PR itself.

- [ ] **Step 8: Update the draft PR body with exact-head evidence.**

Keep the PR draft unless the user explicitly asks to make it ready or merge it.
