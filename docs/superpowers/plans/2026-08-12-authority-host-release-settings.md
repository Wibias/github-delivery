# Authority Host Release Integration + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Windows Delivery Authority host a verified, versioned GitHub Release component that stable install/update can install or upgrade without a local .NET SDK, and add a functional Control Center Settings page for the three existing authority modes.

**Architecture:** The tagged release builds the WinUI host on `windows-latest`, packages it as a separate self-contained `win-x64` asset, and attests it from the protected release workflow. Node-side release verification reuses the existing GitHub release/tag/attestation trust chain, while a focused Windows component installer stages and replaces only release-owned host files while preserving authority state. The Control Center reads/writes the same persistent `authorityMode` config as Node and exposes host version/status from installed metadata.

**Tech Stack:** Node.js 22/24 ESM, GitHub Actions, .NET 8, WinUI 3 / Windows App SDK, PowerShell, Node `node:test`.

## Global Constraints

- The npm package stays a thin bootstrap; do not bundle the Windows Authority binary into npm.
- Stable Authority-host installation must not require a local .NET SDK.
- The stable source of truth remains the fixed `Wibias/github-delivery` GitHub Release.
- Keep `authorityMode` values exactly `off`, `high-assurance`, and `all`.
- Keep persistent default `authorityMode = off`.
- Keep named pipe `github-delivery-authority-v1`.
- Preserve `%LOCALAPPDATA%\GitHubDeliveryAuthority\authority.db` and `trust-store.json` across host upgrades.
- Preserve `%LOCALAPPDATA%\github-delivery\config.json` across all skill/host upgrades.
- Do not install the Authority host for a Windows user with `off` when no host is already installed.
- If the host is already installed, stable update may upgrade it even when the current mode is `off`.
- Never automatically downgrade an Authority host that is ahead of the stable release.
- All downloaded Authority binaries must be version/source/digest/attestation verified before mutation.
- Non-Windows stable install/update behavior must remain unchanged.

---

### Task 1: Build a deterministic Authority-host release package

**Files:**
- Modify: `scripts/lib/distribution.mjs`
- Create: `scripts/build-authority-host-release.mjs`
- Create: `tests/unit/authority-host-release-package.test.mjs`

**Interfaces:**
- Consumes: an already-published self-contained directory from `dotnet publish` plus `version` and tagged `sourceCommit`.
- Produces: `buildAuthorityHostRelease({ publishDir, outDir, version, sourceCommit }) -> { archivePath, metadataPath, metadata }`.
- Produces release metadata kind `github-delivery/authority-host-release` and archive name `github-delivery-authority-v<version>-win-x64.zip`.

- [ ] **Step 1: Write failing packaging tests**

Create `tests/unit/authority-host-release-package.test.mjs` with a temporary fake publish directory and assert exact asset identity and metadata:

```js
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAuthorityHostRelease } from "../../scripts/build-authority-host-release.mjs";

const sourceCommit = "a".repeat(40);

test("packages a version-bound win-x64 authority host asset", () => {
  const root = mkdtempSync(join(tmpdir(), "gd-authority-package-"));
  const publishDir = join(root, "publish");
  const outDir = join(root, "out");
  mkdirSync(publishDir, { recursive: true });
  writeFileSync(join(publishDir, "GitHubDeliveryAuthority.exe"), "exe");
  writeFileSync(join(publishDir, "Microsoft.WindowsAppRuntime.dll"), "dll");

  const result = buildAuthorityHostRelease({
    publishDir,
    outDir,
    version: "0.5.2",
    sourceCommit,
  });

  assert.equal(result.metadata.version, "0.5.2");
  assert.equal(result.metadata.sourceCommit, sourceCommit);
  assert.equal(result.metadata.platform, "win32");
  assert.equal(result.metadata.arch, "x64");
  assert.equal(result.metadata.archive, "github-delivery-authority-v0.5.2-win-x64.zip");
  assert.match(result.metadata.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    JSON.parse(readFileSync(result.metadataPath, "utf8")),
    result.metadata,
  );
});
```

Also assert invalid versions/source SHAs fail and that the generated archive contains `GitHubDeliveryAuthority/authority-host-version.json`.

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node --test tests/unit/authority-host-release-package.test.mjs
```

Expected: FAIL because `scripts/build-authority-host-release.mjs` does not exist.

- [ ] **Step 3: Export the existing stored ZIP writer instead of duplicating ZIP code**

In `scripts/lib/distribution.mjs`, rename/export the current private `zipArchive(entries)` as:

```js
export function createStoredZipArchive(entries) {
  // existing zipArchive implementation, unchanged
}
```

Update the existing skill distribution caller to use `createStoredZipArchive(entries)` so normal distribution bytes stay identical.

- [ ] **Step 4: Implement the Authority release packager**

Create `scripts/build-authority-host-release.mjs` with validation and a callable export. The core shape must be:

```js
export function buildAuthorityHostRelease({ publishDir, outDir, version, sourceCommit }) {
  validateVersion(version);
  validateCommit(sourceCommit);
  const archiveName = `github-delivery-authority-v${version}-win-x64.zip`;
  const metadataName = `github-delivery-authority-v${version}-win-x64.json`;
  const versionInfo = {
    schemaVersion: 1,
    kind: "github-delivery/authority-host-version",
    version,
    sourceCommit: sourceCommit.toLowerCase(),
    platform: "win32",
    arch: "x64",
  };
  // collect regular files from publishDir, reject links, inject
  // GitHubDeliveryAuthority/authority-host-version.json, build stored ZIP,
  // hash archive, write release metadata.
}
```

The release metadata must exactly match the design document. Reject symlinks/reparse-point-like unexpected entries where detectable, duplicate relative paths, absolute paths, `..`, empty publish directories, and missing `GitHubDeliveryAuthority.exe`.

- [ ] **Step 5: Run packaging tests**

Run:

```bash
node --test tests/unit/authority-host-release-package.test.mjs tests/unit/distribution*.test.mjs
```

Expected: PASS and existing distribution tests remain byte-compatible.

- [ ] **Step 6: Commit the packaging unit**

Commit message:

```text
build: package versioned authority host asset
```

---

### Task 2: Publish and attest the Authority host from `release.yml`

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Create: `tests/unit/release-authority-asset.test.mjs`

**Interfaces:**
- Consumes: Task 1 `scripts/build-authority-host-release.mjs`.
- Produces workflow artifact `github-delivery-authority-${{ github.sha }}` containing the `.zip` and `.json`.
- Publishes both files as GitHub Release assets and attests the `.zip` from `release.yml`.

- [ ] **Step 1: Write failing workflow contract tests**

Create `tests/unit/release-authority-asset.test.mjs` that reads `.github/workflows/release.yml` and asserts:

```js
assert.match(workflow, /authority_host:/);
assert.match(workflow, /runs-on: windows-latest/);
assert.match(workflow, /dotnet publish[\s\S]*--runtime win-x64[\s\S]*--self-contained true/);
assert.match(workflow, /build-authority-host-release\.mjs/);
assert.match(workflow, /actions\/upload-artifact@/);
assert.match(workflow, /actions\/download-artifact@/);
assert.match(workflow, /github-delivery-authority-v\*\.zip/);
assert.match(workflow, /Attest Windows authority host/);
assert.match(workflow, /gh release create[\s\S]*github-delivery-authority-v\*\.json/);
```

Extend `windows-authority-winui.test.mjs` so CI still proves the host is self-contained but does not treat the source installer as the stable binary distribution mechanism.

- [ ] **Step 2: Run the workflow tests and verify they fail**

Run:

```bash
node --test tests/unit/release-authority-asset.test.mjs tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL on missing release job/assets.

- [ ] **Step 3: Add the Windows release build job**

Add a job after `validate`:

```yaml
authority_host:
  name: Build Windows authority host release asset
  needs: validate
  runs-on: windows-latest
  permissions:
    contents: read
  steps:
    - name: Check out repository
      uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false
    - name: Set up Node.js
      uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
      with:
        node-version: 22
        package-manager-cache: false
    - name: Restore and publish Windows authority host
      shell: pwsh
      run: |
        $Project = 'authority-host/windows/GitHubDeliveryAuthority/GitHubDeliveryAuthority.csproj'
        $PublishDir = Join-Path $env:RUNNER_TEMP 'github-delivery-authority-publish'
        dotnet restore $Project --locked-mode
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        dotnet publish $Project --configuration Release --runtime win-x64 --self-contained true --no-restore --output $PublishDir /p:Version=${{ steps.release_version.outputs.version }}
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Resolve the semantic version from `package.json` in a preceding step and pass it to both `dotnet publish` and `scripts/build-authority-host-release.mjs` together with `${{ github.sha }}`.

- [ ] **Step 4: Upload the Windows asset from the build job**

Use the already-pinned `actions/upload-artifact` version used by the repo and upload only:

```text
<out>/github-delivery-authority-v*.zip
<out>/github-delivery-authority-v*.json
```

with `if-no-files-found: error`.

- [ ] **Step 5: Make protected publish depend on the Windows artifact**

Change:

```yaml
needs: validate
```

to:

```yaml
needs:
  - validate
  - authority_host
```

Download the artifact before attest/publish, attest the Authority ZIP with `actions/attest`, and include both Authority files in `gh release create`.

- [ ] **Step 6: Run workflow/security checks**

Run:

```bash
node --test tests/unit/release-authority-asset.test.mjs tests/unit/windows-authority-winui.test.mjs
npm run security:repo
```

Expected: PASS.

- [ ] **Step 7: Commit the release workflow unit**

Commit message:

```text
release: publish attested authority host asset
```

---

### Task 3: Verify and extract the Authority-host release asset

**Files:**
- Create: `scripts/lib/authority-host-release.mjs`
- Modify: `scripts/lib/release-self-update.mjs`
- Create: `tests/unit/authority-host-release.test.mjs`

**Interfaces:**
- Consumes: `createGitHubReleaseClient()`, `verifyGitHubAssetDigest()`, and `verifyReleaseAttestation()` from the existing stable-release trust chain.
- Produces: `acquireVerifiedAuthorityHostPayload({ release, workspace, client, sourceCommit, attestationRunner })`.
- Produces: `{ verified: true, source, metadata, archivePath, release: { tag, version, sourceCommit } }`.

- [ ] **Step 1: Write failing metadata and verification tests**

Cover exact success plus rejection of wrong version, platform, arch, source commit, archive name, SHA-256, duplicate assets, malformed GitHub asset digest, and attestation failure.

Use a fake release with:

```js
const release = {
  tag_name: "v0.5.2",
  draft: false,
  prerelease: false,
  assets: [
    { name: "github-delivery-authority-v0.5.2-win-x64.zip", browser_download_url: "https://example.test/host.zip" },
    { name: "github-delivery-authority-v0.5.2-win-x64.json", browser_download_url: "https://example.test/host.json" },
  ],
};
```

Include malicious ZIP fixtures for `../`, absolute paths, duplicate entries, unsupported compression/data descriptors, and unbounded file/total sizes.

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test tests/unit/authority-host-release.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Export the reusable stable-release helpers needed by the component verifier**

From `scripts/lib/release-self-update.mjs`, export the existing `verifyGitHubAssetDigest` and keep `verifyReleaseAttestation` public. Do not weaken their existing constraints.

- [ ] **Step 4: Implement strict Authority metadata validation**

Create:

```js
export function validateAuthorityHostReleaseMetadata(value, { version, sourceCommit } = {}) {
  if (
    value?.schemaVersion !== 1 ||
    value?.kind !== "github-delivery/authority-host-release" ||
    value?.version !== version ||
    value?.sourceCommit?.toLowerCase() !== sourceCommit.toLowerCase() ||
    value?.platform !== "win32" ||
    value?.arch !== "x64" ||
    value?.archive !== `github-delivery-authority-v${version}-win-x64.zip` ||
    !/^[0-9a-f]{64}$/i.test(value?.sha256 || "")
  ) throw new Error("authority_host_release_metadata_invalid");
  return { ...value, sourceCommit: value.sourceCommit.toLowerCase(), sha256: value.sha256.toLowerCase() };
}
```

- [ ] **Step 5: Implement bounded extraction under one fixed root**

The Authority ZIP must contain only regular files beneath:

```text
GitHubDeliveryAuthority/
```

Use the same central-directory/local-header validation rules as `release-zip.mjs`, but Authority-specific limits large enough for a self-contained WinUI app, for example:

```js
const AUTHORITY_LIMITS = Object.freeze({
  maxArchiveBytes: 256 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFiles: 4096,
});
```

Do not shell out to an unconstrained archive extractor.

- [ ] **Step 6: Implement acquisition and attestation verification**

`acquireVerifiedAuthorityHostPayload` must:

1. derive version from `release.tag_name`;
2. require exactly one versioned `.zip` and `.json` asset;
3. download with explicit size limits;
4. verify GitHub asset digests if present;
5. parse metadata;
6. compare archive SHA-256 to metadata;
7. compare tag source SHA to metadata source SHA;
8. persist the archive to a private workspace;
9. call `verifyReleaseAttestation({ archivePath, tag, sourceCommit })`;
10. strictly extract and return the staged root.

- [ ] **Step 7: Run verification tests**

```bash
node --test tests/unit/authority-host-release.test.mjs tests/unit/release-self-update.test.mjs tests/unit/release-zip.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit the verification unit**

Commit message:

```text
security: verify authority host release assets
```

---

### Task 4: Install and upgrade the verified Windows component without .NET SDK

**Files:**
- Create: `scripts/lib/authority-host-install.mjs`
- Create: `authority-host/windows/install-release.ps1`
- Modify: `authority-host/windows/install.ps1`
- Create: `tests/unit/authority-host-install.test.mjs`
- Modify: `tests/unit/windows-authority-winui.test.mjs`

**Interfaces:**
- Produces: `readInstalledAuthorityHost({ env, platform, arch })`.
- Produces: `planAuthorityHostUpdate({ installed, releaseVersion, mode, platform, arch })`.
- Produces: `applyVerifiedAuthorityHost({ source, metadata, env, runner })`.
- PowerShell installer accepts `-SourceDir`, optional `-InstallDir`, optional `-PipeName`, and `-Setup`.

- [ ] **Step 1: Write the decision-matrix tests**

Add exact cases:

```js
assert.equal(planAuthorityHostUpdate({ installed: null, releaseVersion: "0.5.2", mode: "off", platform: "win32", arch: "x64" }).action, "skip");
assert.equal(planAuthorityHostUpdate({ installed: null, releaseVersion: "0.5.2", mode: "high-assurance", platform: "win32", arch: "x64" }).action, "install");
assert.equal(planAuthorityHostUpdate({ installed: { version: "0.5.1" }, releaseVersion: "0.5.2", mode: "off", platform: "win32", arch: "x64" }).action, "update");
assert.equal(planAuthorityHostUpdate({ installed: { version: "0.5.2" }, releaseVersion: "0.5.2", mode: "all", platform: "win32", arch: "x64" }).action, "already_current");
assert.equal(planAuthorityHostUpdate({ installed: { version: "0.6.0" }, releaseVersion: "0.5.2", mode: "all", platform: "win32", arch: "x64" }).action, "already_ahead");
```

Also test a legacy install: executable exists but `authority-host-version.json` does not -> `installed.legacy === true` and action `update` when stable update/setup is allowed.

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/authority-host-install.test.mjs
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement installed-host detection**

The canonical path is:

```js
join(env.LOCALAPPDATA, "GitHubDeliveryAuthority")
```

Require `GitHubDeliveryAuthority.exe` plus valid `authority-host-version.json` for a versioned install. Parse only schema version 1, semantic version, 40-char source SHA, `win32`, `x64`. If the executable exists without valid metadata, return a legacy/unversioned result rather than pretending it is current.

- [ ] **Step 4: Implement the pure update planner**

Return only these actions:

```text
skip
unsupported
install
update
already_current
already_ahead
```

`off + missing` => `skip`; installed host participates regardless of `off`; `high-assurance|all + missing` => `install` on Windows x64.

- [ ] **Step 5: Write the release installer PowerShell script**

`authority-host/windows/install-release.ps1` must not call `dotnet`. It receives an already verified staged publish directory and:

```powershell
$StateFiles = @('authority.db', 'trust-store.json')
```

It must stop only `GitHubDeliveryAuthority` processes whose resolved executable path is inside `$InstallDir`, preserve the state files, replace runtime files from `$SourceDir`, recreate the Startup shortcut, set `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE` and `GITHUB_DELIVERY_AUTHORITY_PIPE` at User scope, then start the executable. Use `--setup` only for a fresh install or explicit `-Setup` request; upgrading an existing stateful install must not force repository setup.

Before success, require:

```powershell
Test-Path (Join-Path $InstallDir 'GitHubDeliveryAuthority.exe')
Test-Path (Join-Path $InstallDir 'authority-host-version.json')
```

- [ ] **Step 6: Make source `install.ps1` delegate deployment semantics**

Keep its .NET prerequisite/build steps for development, but after `dotnet publish` invoke `install-release.ps1 -SourceDir $publish ...` rather than maintaining a second independent copy/shortcut/process-stop implementation.

This creates one deployment boundary for both source and stable release installation.

- [ ] **Step 7: Implement the Node apply wrapper**

`applyVerifiedAuthorityHost` must invoke PowerShell with argument arrays and `shell: false`, then re-read installed metadata and require exact version/source equality before returning success.

- [ ] **Step 8: Add preservation and no-.NET regression tests**

Tests must assert the release installer text contains no `dotnet publish`/SDK requirement, preserves both state files, restricts process stopping by executable path, and verifies post-install metadata.

- [ ] **Step 9: Run install tests**

```bash
node --test tests/unit/authority-host-install.test.mjs tests/unit/windows-authority-winui.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit the component installer**

Commit message:

```text
feat: safely install verified authority host builds
```

---

### Task 5: Integrate Authority-host planning into setup, update, and doctor

**Files:**
- Modify: `scripts/lib/bootstrap-maintenance.mjs`
- Modify: `scripts/install-skill.mjs`
- Modify: `scripts/lib/bootstrap-cli.mjs` if output/help text needs component status
- Modify: `tests/unit/bootstrap-maintenance.test.mjs`
- Modify: `tests/unit/stable-release-update.test.mjs`
- Create: `tests/unit/authority-host-bootstrap.test.mjs`

**Interfaces:**
- Consumes Tasks 3-4 verifier/planner/apply functions.
- Extends setup/update/doctor results with `authorityHost`.

- [ ] **Step 1: Write failing bootstrap integration tests**

Cover these exact scenarios:

1. setup + `off` + missing host -> no network/install action;
2. setup + `high-assurance` + missing host -> verified install;
3. setup + `all` + stale host -> verified update;
4. update dry-run + skill current + host stale -> reports host `update` rather than global no-op;
5. update `--apply` + skill current + host stale -> upgrades host;
6. update `--apply` + skill update + host stale -> both components update;
7. host ahead -> no downgrade;
8. Linux/macOS -> no host install attempt;
9. doctor reports `missing`, `legacy`, `update`, `already_current`, and `already_ahead` relations.

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/authority-host-bootstrap.test.mjs tests/unit/bootstrap-maintenance.test.mjs
```

Expected: FAIL on absent `authorityHost` integration.

- [ ] **Step 3: Add a component-status helper**

In `bootstrap-maintenance.mjs`, add a focused helper that reads user config, resolves effective authority mode, reads the installed host, and computes the host plan against the same stable release version used for the skill.

Do not duplicate authority-mode parsing; use `resolveAuthorityMode` from `user-config.mjs`.

- [ ] **Step 4: Integrate setup**

Before returning `status: "ready"`, setup must ensure a required (`high-assurance`/`all`) Windows host is installed/current. If host acquisition or install fails, return/throw an explicit authority-host setup error instead of reporting ready.

If the host is missing and mode is `off`, setup must not download the host asset.

- [ ] **Step 5: Integrate stable update without losing the already-current repair path**

Refactor the current early return:

```js
if (candidate.plan.action === "already_current" || candidate.plan.action === "already_ahead") {
  return ...;
}
```

so an already-current skill can still repair/update an installed stale Authority host. The result should expose:

```js
{
  action: "update",
  updated: skillUpdated || authorityHostUpdated,
  skill: { ... },
  authorityHost: { action, updated, version, previousVersion, error: null },
}
```

Do not report `updated: false` when a stale host was actually replaced.

- [ ] **Step 6: Integrate doctor**

Add:

```js
authorityHost: {
  supported,
  installed,
  legacy,
  version,
  sourceCommit,
  relation,
  requiredByMode,
  error,
}
```

`requiredByMode` is true only for effective `high-assurance` or `all`.

- [ ] **Step 7: Run bootstrap/update tests**

```bash
node --test tests/unit/authority-host-bootstrap.test.mjs tests/unit/bootstrap-maintenance.test.mjs tests/unit/stable-release-update.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit bootstrap integration**

Commit message:

```text
feat: keep authority host aligned with stable updates
```

---

### Task 6: Implement the functional WinUI Settings page and version status

**Files:**
- Modify: `authority-host/windows/GitHubDeliveryAuthority/UserConfigStore.cs`
- Create: `authority-host/windows/GitHubDeliveryAuthority/AuthorityVersionInfo.cs`
- Create: `authority-host/windows/GitHubDeliveryAuthority/SettingsView.xaml`
- Create: `authority-host/windows/GitHubDeliveryAuthority/SettingsView.xaml.cs`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml`
- Modify: `authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs`
- Modify: `tests/unit/windows-authority-winui.test.mjs`
- Modify: `tests/unit/user-config.test.mjs` only if cross-language schema contract coverage needs extension

**Interfaces:**
- `UserConfigStore.WriteAuthorityMode(string mode) -> DeliveryUserConfig`.
- `UserConfigStore.ResolveEffectiveMode(DeliveryUserConfig stored) -> (string Mode, string? OverrideSource)` or equivalent focused record.
- `AuthorityVersionInfo.Read() -> AuthorityVersionInfo?` from `AppPaths.RootDirectory/authority-host-version.json`.
- `SettingsView.Refresh()` reloads current config/version status.

- [ ] **Step 1: Write failing GUI contract tests**

Extend `windows-authority-winui.test.mjs` to assert:

```js
const control = read(`${root}/ControlCenterWindow.xaml`);
const settings = read(`${root}/SettingsView.xaml`);
const configStore = read(`${root}/UserConfigStore.cs`);

assert.match(control, /SelectionChanged="Navigation_SelectionChanged"/);
assert.match(control, /SettingsView/);
for (const text of ["Off", "Sensitive actions", "Every GitHub write", "Recommended", "Apply"]) {
  assert.match(settings, new RegExp(text));
}
assert.match(configStore, /WriteAuthorityMode/);
assert.match(configStore, /File\.Move\([\s\S]*overwrite:\s*true/);
```

Also assert Settings displays Authority version and effective override warning copy.

- [ ] **Step 2: Run and verify failure**

```bash
node --test tests/unit/windows-authority-winui.test.mjs
```

Expected: FAIL because `SettingsView` and write support do not exist.

- [ ] **Step 3: Add atomic C# config writes with the exact Node schema**

Implement validation:

```csharp
private static bool IsValidMode(string mode)
    => mode is "off" or "high-assurance" or "all";
```

Write JSON:

```json
{
  "schemaVersion": 1,
  "authorityMode": "high-assurance"
}
```

Create the parent directory, write to a uniquely named temp file in the same directory, then atomically replace/move onto `ConfigPath`. Do not write when simply opening Settings.

Mirror environment override precedence:

1. `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` => `all`;
2. `GITHUB_DELIVERY_AUTHORITY_MODE` if valid;
3. stored config.

- [ ] **Step 4: Add version metadata reader**

`AuthorityVersionInfo.cs` validates schema/kind/version/source/platform/arch before display. Invalid metadata must yield an explicit unavailable/invalid status rather than crashing the Control Center.

- [ ] **Step 5: Build the Settings view**

Use three radio buttons/cards mapped exactly:

```text
Off                 -> off
Sensitive actions   -> high-assurance
Every GitHub write  -> all
```

`Sensitive actions` carries a `Recommended` label. Add concise descriptions preserving the policy wording from `references/configuration.md`.

The view shows stored mode, effective mode, host version, and source commit. If an environment override changes effective mode, show a visible warning that Apply changes the stored preference but not the active override.

- [ ] **Step 6: Wire real navigation**

Add `SelectionChanged="Navigation_SelectionChanged"` to the `NavigationView`. Wrap the existing dashboard content and `SettingsView` in named containers. Handler behavior:

```csharp
var tag = (Navigation.SelectedItem as NavigationViewItem)?.Tag?.ToString();
DashboardContent.Visibility = tag == "settings" ? Visibility.Collapsed : Visibility.Visible;
SettingsContent.Visibility = tag == "settings" ? Visibility.Visible : Visibility.Collapsed;
if (tag == "settings") SettingsContent.Refresh();
```

The existing `OpenSettings_Click` continues selecting the Settings item, which now causes real content navigation.

- [ ] **Step 7: Build and self-test the WinUI host**

On Windows CI/local Windows:

```powershell
dotnet restore .\authority-host\windows\GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj --locked-mode
dotnet build .\authority-host\windows\GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj -c Release --no-restore
dotnet run --project .\authority-host\windows\GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj -c Release --no-build -- --self-test
```

Expected: all succeed.

- [ ] **Step 8: Run Node GUI/config regressions**

```bash
node --test tests/unit/windows-authority-winui.test.mjs tests/unit/user-config.test.mjs tests/unit/authority-mode-enforcement.test.mjs
```

Expected: PASS and no authority-mode semantic changes.

- [ ] **Step 9: Commit the GUI unit**

Commit message:

```text
feat: add authority protection settings UI
```

---

### Task 7: Document the unified component lifecycle and run the full gate

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `authority-host/windows/README.md`
- Modify: `references/configuration.md`
- Modify: `CHANGELOG.md`
- Modify tests only if documentation contracts require exact copy updates

**Interfaces:**
- User-facing commands remain `npx github-delivery`, `setup`, `doctor`, `update`, and `update --apply`.
- Source-development Authority install remains `authority-host/windows/install.ps1`.

- [ ] **Step 1: Update docs with the new stable lifecycle**

Document these user-visible facts exactly:

```text
- Stable GitHub Releases include a separately verified self-contained Windows Authority host asset.
- Users do not need the .NET SDK for stable Authority host install/update.
- If Authority is already installed, stable update keeps it aligned with the skill.
- If protection is Off and Authority was never installed, update does not install it.
- Control Center -> Settings contains Off / Sensitive actions / Every GitHub write.
- doctor reports skill and Authority-host version/status separately.
```

Keep the source `install.ps1` instructions explicitly labeled as repository/development installation.

- [ ] **Step 2: Add an Unreleased changelog entry**

Describe both root-cause fixes: stale separately-installed authority binaries after skill upgrades, and the previously non-functional Settings destination.

- [ ] **Step 3: Run focused release/component tests**

```bash
node --test \
  tests/unit/authority-host-release-package.test.mjs \
  tests/unit/release-authority-asset.test.mjs \
  tests/unit/authority-host-release.test.mjs \
  tests/unit/authority-host-install.test.mjs \
  tests/unit/authority-host-bootstrap.test.mjs \
  tests/unit/windows-authority-winui.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run the repository full gate**

```bash
npm run check
```

Expected: PASS on Node 22/24 supported environments. Windows CI additionally must build/publish/self-test the Authority host.

- [ ] **Step 5: Inspect the final diff for scope**

Verify the PR changes only release packaging, Authority component install/update/doctor integration, WinUI Settings/version status, associated tests, and docs. Do not include unrelated mutation-policy or watchdog changes.

- [ ] **Step 6: Commit docs/final integration**

Commit message:

```text
docs: document authority host component lifecycle
```

- [ ] **Step 7: Mark the PR ready only after CI is green and implementation review passes**

Keep the PR draft while any implementation task remains incomplete or while the Windows Authority build/release tests are not green.
