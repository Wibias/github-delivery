# Verified Release Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an installed `github-delivery` bundle securely check for and apply a strictly newer published stable release through `node scripts/install-skill.mjs --update`, without a repository checkout and without weakening the existing install, local-modification, hook-trust, or backup guarantees.

**Architecture:** Keep the existing stable-update workflow and installation core authoritative. Harden `stable-release-update.mjs` for strict version/path/asset semantics, add a small verified-release acquisition orchestrator plus a separate strict ZIP parser/extractor, route both `install-skill.mjs --update` and the legacy `update-skill.mjs` through that shared path, and reuse `planInstallation`/`applyInstallation` for the actual replacement. Release acquisition is fail-closed through GitHub asset digests, `SHA256SUMS`, manifest identity, tag/source-commit binding, and constrained `gh attestation verify` before any installation mutation is possible.

**Tech Stack:** Node.js 22/24 ESM, built-in `fetch`, `node:crypto`, `node:fs`, `node:child_process`, `node:test`, deterministic repository ZIP format, GitHub Releases REST API, GitHub CLI artifact attestation verification.

## Global Constraints

- Update source is fixed to published, non-draft, non-prerelease releases from `Wibias/github-delivery` only.
- `--update` is read-only; `--update --apply` is the only self-update replacement path.
- `main`, branches, forks, arbitrary URLs, GitHub-generated source archives, prereleases, and downgrades are never accepted by `--update`.
- A release ZIP must pass GitHub asset digest checks when exposed, strict `SHA256SUMS`, manifest validation, tag/source-commit binding, and GitHub artifact-attestation verification. There is no weaker fallback.
- Existing local modifications inside the installed skill remain a hard update blocker.
- Existing `planInstallation`, `applyInstallation`, backup/restore, hook trust, watchdog activation, and user-config preservation remain authoritative.
- The legacy `scripts/update-skill.mjs` entrypoint remains supported but delegates to the same implementation as `install-skill.mjs --update`.
- Self-update defaults its target to the installed bundle containing the running installer when no `--target` is supplied. An explicit `--target` still wins.
- A repository checkout is not silently treated as an installed bundle: update targets must contain a valid installed `manifest.json`.
- Network and attestation behavior is injectable so unit tests remain deterministic and offline.
- Release ZIP extraction supports the repository's deterministic stored ZIP format only and fails closed on unsupported ZIP features.
- Production changes follow RED -> GREEN -> REFACTOR TDD. Test-only RED commits must demonstrate missing behavior before production code is added.

---

### Task 1: Harden stable-release planning and installed-manifest safety

**Files:**
- Modify: `scripts/lib/stable-release-update.mjs`
- Modify: `tests/unit/setup-update-workflows.test.mjs`
- Create: `tests/unit/stable-release-update-security.test.mjs`

**Interfaces:**
- `validateManifestPath(path: string) -> string` rejects absolute, drive/UNC, traversal, empty, backslash-normalization ambiguity, and NUL-containing paths.
- `compareStableVersions(left: string, right: string) -> -1 | 0 | 1` compares strict numeric `major.minor.patch` strings.
- `releaseAssetPlan(release) -> { tag, version, archive, manifest, checksums, assetsByName }` requires each required asset exactly once.
- `planStableUpdate(...)` returns actions `update`, `already_current`, `already_ahead`, or `blocked_local_modifications` and never maps an older release to `update`.
- `parseChecksums(source)` rejects duplicate required names instead of silently overwriting them.

- [ ] **Step 1: Write failing tests for version direction and duplicate assets.**

```js
test("stable update never downgrades an ahead installation", () => {
  const plan = planStableUpdate({
    releases: [{ tag_name: "v0.3.0", draft: false, prerelease: false, assets: requiredAssets("0.3.0") }],
    target: "/skill",
    installedManifest: manifest("0.4.0"),
    dependencies: cleanInstalledDependencies(),
  });
  assert.equal(plan.action, "already_ahead");
  assert.equal(plan.safeToReplace, true);
});

test("required release assets must occur exactly once", () => {
  const release = stableRelease("0.5.0");
  release.assets.push({ ...release.assets[0] });
  assert.throws(() => releaseAssetPlan(release), /stable_release_asset_duplicate/);
});
```

- [ ] **Step 2: Write failing tests for malicious installed-manifest paths and duplicate checksum entries.**

```js
test("installed manifest paths cannot escape the target", () => {
  assert.throws(
    () => compareInstalledManifest({
      manifest: manifest("0.4.0", [{ path: "../outside", sha256: "a".repeat(64) }]),
      target: "/skill",
      dependencies: cleanInstalledDependencies(),
    }),
    /installed_manifest_path_invalid/,
  );
});

test("checksum parser rejects duplicate names", () => {
  const row = `${"a".repeat(64)}  manifest.json`;
  assert.throws(() => parseChecksums(`${row}\n${row}\n`), /stable_release_checksums_duplicate/);
});
```

- [ ] **Step 3: Commit the tests-only RED head and verify CI fails for the intended missing semantics.**

Expected failures: `already_ahead` is currently reported as `update`; duplicate release assets/checksum entries are not rejected; unsafe manifest paths reach path joining.

- [ ] **Step 4: Implement the minimal strict helpers and update `planStableUpdate`.**

Use strict versions only:

```js
export function compareStableVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ""));
    if (!match) throw new Error("stable_release_version_invalid");
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
```

Map clean version states explicitly:

```js
const comparison = compareStableVersions(assets.version, current.version);
const action = !local.clean
  ? "blocked_local_modifications"
  : comparison > 0
    ? "update"
    : comparison === 0
      ? "already_current"
      : "already_ahead";
```

- [ ] **Step 5: Run the targeted tests and verify GREEN.**

Run: `node --test tests/unit/setup-update-workflows.test.mjs tests/unit/stable-release-update-security.test.mjs`

- [ ] **Step 6: Commit.**

```bash
git add scripts/lib/stable-release-update.mjs tests/unit/setup-update-workflows.test.mjs tests/unit/stable-release-update-security.test.mjs
git commit -m "fix: harden stable update planning"
```

### Task 2: Strict deterministic release ZIP parser and extractor

**Files:**
- Create: `scripts/lib/release-zip.mjs`
- Create: `tests/unit/release-zip.test.mjs`

**Interfaces:**
- `inspectReleaseZip(buffer, options?) -> { entries: Array<{ path, bytes, mode, crc32, dataOffset }> }`
- `extractVerifiedReleaseZip({ archive, manifest, destination, limits? }) -> { root, files }`
- Supported ZIP contract is deliberately narrow: EOCD + central directory + local headers, UTF-8 names, method `0` (stored), no encryption, no data descriptors, no multi-disk archives, no ZIP64, no symlinks/special files, one `github-delivery/` root.
- Defaults: maximum archive bytes 32 MiB, maximum individual extracted file 16 MiB, maximum total extracted bytes 64 MiB, maximum 4096 files.

- [ ] **Step 1: Write a valid-archive test using `buildDistribution`.**

```js
test("extracts the repository deterministic release ZIP", () => {
  const fixture = buildReleaseFixture();
  const archive = readFileSync(fixture.zip);
  const manifest = JSON.parse(readFileSync(fixture.manifest, "utf8"));
  const destination = join(fixture.root, "extract");
  const result = extractVerifiedReleaseZip({ archive, manifest, destination });
  assert.equal(result.root, join(destination, "github-delivery"));
  assert.equal(readFileSync(join(result.root, "package.json"), "utf8").includes(manifest.version), true);
});
```

- [ ] **Step 2: Write crafted failing ZIP tests for traversal and platform paths.**

Craft small stored ZIPs in the test helper and assert rejection of:

```text
../outside
/github-delivery/file
C:/github-delivery/file
\\server\share\file
github-delivery/../../outside
github-delivery/a\..\outside
name containing NUL
```

Expected error family: `release_zip_path_invalid`.

- [ ] **Step 3: Write failing tests for duplicate normalized paths, symlink/special mode, unsupported compression/data-descriptor/ZIP64, extra undeclared file, missing declared file, archive-manifest mismatch, CRC mismatch, and per-file/total expansion limits.**

- [ ] **Step 4: Commit the archive tests-only RED head and verify RED in CI because `release-zip.mjs` does not exist.**

- [ ] **Step 5: Implement central-directory-first parsing.**

Key checks before reading entry data:

```js
if (method !== 0) throw new Error("release_zip_compression_unsupported");
if ((flags & 0x1) !== 0) throw new Error("release_zip_encryption_unsupported");
if ((flags & 0x8) !== 0) throw new Error("release_zip_data_descriptor_unsupported");
if ((flags & 0x800) === 0) throw new Error("release_zip_utf8_required");
```

Normalize and require exactly the `github-delivery/` root before joining any filesystem path. Treat the central directory's Unix file type bits as authoritative and accept regular files only. Cross-check local-header name/method/flags/sizes/CRC against the central directory, reject overlapping/out-of-bounds regions, and verify CRC32 before writing.

- [ ] **Step 6: Implement manifest-bound extraction.**

Build the allowed set as `manifest.files` plus `manifest.json`; reject any other file. Require archive `manifest.json` bytes to equal the separately verified manifest bytes supplied by the orchestrator. After extraction, hash and size-check every manifest entry before returning `root`.

- [ ] **Step 7: Run archive tests GREEN on Node 22 and 24 CI runners.**

Run locally when available: `node --test tests/unit/release-zip.test.mjs`

- [ ] **Step 8: Commit.**

```bash
git add scripts/lib/release-zip.mjs tests/unit/release-zip.test.mjs
git commit -m "feat: add strict release zip extraction"
```

### Task 3: Verified release acquisition and provenance chain

**Files:**
- Create: `scripts/lib/release-self-update.mjs`
- Create: `tests/unit/release-self-update.test.mjs`
- Modify: `scripts/lib/stable-release-update.mjs` only if a pure helper needs to be reused rather than duplicated.

**Interfaces:**
- `createGitHubReleaseClient({ fetchImpl = fetch })` exposes `latestRelease()`, `downloadAsset(asset, limit)`, and `resolveTagCommit(tag)`.
- `validateReleaseManifest(value, { version }) -> normalizedManifest` validates schema/name/version/sourceCommit/files/path/hash/size/mode shape.
- `verifyGitHubAssetDigest(asset, content)` enforces exposed `sha256:` digests.
- `verifyReleaseAttestation({ archivePath, tag, sourceCommit, runner })` runs `gh attestation verify` with exact repository/workflow/ref/source-digest constraints.
- `acquireVerifiedRelease({ target, workspace, releaseClient, attestationRunner }) -> { plan, source, manifest, release }` performs all read/verification work and returns a verified extracted source only for a newer clean install.
- `verifyInstalledRelease({ target, manifest })` verifies post-install package/manifest/file hashes and sizes.

- [ ] **Step 1: Write failing release-metadata/download tests.**

Cover latest endpoint success, draft/prerelease rejection, invalid tags, missing/duplicate assets, malformed asset digest, asset digest mismatch, HTTPS-only redirect handling, response-size limits, and temp cleanup through injected fake client behavior.

- [ ] **Step 2: Write failing strict manifest tests.**

Reject wrong schema/kind/name/version, non-40-character `sourceCommit`, duplicate paths, unsafe paths, invalid SHA-256, negative/non-integer sizes, unsupported modes, and duplicate `manifest.json` declaration.

- [ ] **Step 3: Write failing tag peeling tests.**

The fake client must cover:

```js
// lightweight
{ object: { type: "commit", sha: sourceCommit } }

// annotated
{ object: { type: "tag", sha: tagObjectSha } }
// then tag object -> { object: { type: "commit", sha: sourceCommit } }
```

Reject cycles, excessive tag depth, non-commit terminal objects, and source-commit mismatch.

- [ ] **Step 4: Write failing attestation-runner tests for the exact command.**

Required arguments:

```text
gh attestation verify <archive>
  --repo Wibias/github-delivery
  --signer-workflow Wibias/github-delivery/.github/workflows/release.yml
  --source-ref refs/tags/vX.Y.Z
  --source-digest <manifest.sourceCommit>
```

A missing executable or non-zero exit throws `stable_release_attestation_failed`; there is no fallback.

- [ ] **Step 5: Commit the verification tests-only RED head and confirm intended CI failures.**

- [ ] **Step 6: Implement a bounded HTTPS release client.**

Use `redirect: "manual"`, a small redirect cap, and require every initial/redirect URL to use `https:`. Stream/read response bodies with byte caps instead of calling unbounded `arrayBuffer()` on attacker-controlled lengths. Send a stable GitHub API Accept header and user agent; do not persist API response bodies.

- [ ] **Step 7: Implement strict asset/checksum/manifest/tag verification.**

Verification order:

```text
release metadata
-> required asset identity
-> download required assets
-> GitHub asset digest
-> strict SHA256SUMS
-> manifest identity/files
-> tag peeled commit == manifest.sourceCommit
-> gh attestation verify
-> strict ZIP extraction
-> extracted manifest/file verification
```

No installation API is called before the final extraction verification succeeds.

- [ ] **Step 8: Run targeted verification tests GREEN.**

Run: `node --test tests/unit/release-self-update.test.mjs tests/unit/release-zip.test.mjs tests/unit/stable-release-update-security.test.mjs`

- [ ] **Step 9: Commit.**

```bash
git add scripts/lib/release-self-update.mjs scripts/lib/stable-release-update.mjs tests/unit/release-self-update.test.mjs
git commit -m "feat: verify stable release updates"
```

### Task 4: Integrate `--update` into the installer and retain the legacy updater

**Files:**
- Modify: `scripts/install-skill.mjs`
- Modify: `scripts/update-skill.mjs`
- Modify: `tests/unit/installer.test.mjs`
- Modify: `tests/unit/watchdog-activation.test.mjs`
- Modify: `tests/unit/setup-update-workflows.test.mjs`
- Create: `tests/unit/release-self-update-integration.test.mjs`

**Interfaces:**
- `parseInstallArgs(argv)` adds `update: boolean`, tracks whether `--target`/`--source` were explicitly supplied, rejects `--update + --source`, `--update + --restore`, and any use of `--allow-downgrade` to alter update semantics.
- Update mode derives its implicit target from `resolve(import.meta.dirname, "..")`, the installed bundle that owns the executing installer. Normal install mode keeps its existing default target.
- `installSkill(options, dependencies?)` remains synchronous for existing local-source installs; add an async `runInstallCommand(options, dependencies?)` wrapper that handles release acquisition/update mode, then calls the existing synchronous install path for the verified extracted source.
- `scripts/update-skill.mjs` becomes a compatibility wrapper around `install-skill.mjs --update`, retaining `--target` and `--apply` behavior.

- [ ] **Step 1: Write failing parser tests.**

```js
test("installer parses release self-update without changing normal defaults", () => {
  const update = parseInstallArgs(["--update"]);
  assert.equal(update.update, true);
  assert.equal(update.apply, false);
  assert.equal(update.target, ROOT); // running installed-bundle root in fixture/injected parser context
});

assert.throws(() => parseInstallArgs(["--update", "--source", "/tmp/source"]), /update_source_conflict/);
assert.throws(() => parseInstallArgs(["--update", "--restore", "/tmp/backup"]), /update_restore_conflict/);
```

Make target-root derivation injectable in tests so the repository checkout is not mistaken for an installed bundle.

- [ ] **Step 2: Write failing integration tests with a fully fake release client/attestation runner.**

Cover:

- dry-run leaves target bytes unchanged;
- `already_current` no-op with and without `--apply`;
- `already_ahead` no-op with and without `--apply`;
- local modifications return/block before replacement;
- verified newer release uses existing backup/atomic replacement;
- verification failure never calls `applyInstallation`;
- successful replacement returns previous/new version, backup path, release tag/source commit and watchdog state;
- user config before/after is byte/semantic-equivalent;
- post-install manifest failure reports failure and preserves backup path;
- changed Codex hook definition produces `hook_trust_required`, not inherited trust.

- [ ] **Step 3: Commit the installer-integration tests-only RED head and verify RED.**

- [ ] **Step 4: Refactor the CLI entrypoint for async update acquisition without changing normal install behavior.**

Direct execution becomes:

```js
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: String(error?.message || error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
```

`main()` parses once and awaits the common command runner. Existing local install tests must continue to pass unchanged.

- [ ] **Step 5: In update mode, require an installed manifest and preserve local modifications.**

Do not allow `--force` to bypass `blocked_local_modifications`; users can use the explicit local-source install/restore mechanisms when they intentionally want replacement semantics outside self-update.

- [ ] **Step 6: Feed the verified extracted source into the existing installer.**

Construct a derived options object with `source` equal to the verified temporary `github-delivery` directory and `allowDowngrade: false`. Call the existing install logic so backup and Codex hook/watchdog behavior stay centralized.

- [ ] **Step 7: Preserve persistent user configuration.**

Snapshot `readUserConfig()` before replacement and again afterward. If config changes unexpectedly, report `stable_update_user_config_changed_unexpectedly`. Do not introduce or modify user settings automatically.

- [ ] **Step 8: Verify the installed postcondition before success.**

Call `verifyInstalledRelease({ target, manifest })`. If it fails after replacement, surface `backupPath` in the structured error/result so the operator can use the existing restore command.

- [ ] **Step 9: Convert `scripts/update-skill.mjs` into a compatibility wrapper.**

It should pass `--update` plus the caller arguments to the shared installer command rather than maintaining its own release download/extraction path.

- [ ] **Step 10: Run installer/watchdog/update tests GREEN.**

Run: `node --test tests/unit/installer.test.mjs tests/unit/watchdog-activation.test.mjs tests/unit/setup-update-workflows.test.mjs tests/unit/release-self-update-integration.test.mjs`

- [ ] **Step 11: Commit.**

```bash
git add scripts/install-skill.mjs scripts/update-skill.mjs tests/unit/installer.test.mjs tests/unit/watchdog-activation.test.mjs tests/unit/setup-update-workflows.test.mjs tests/unit/release-self-update-integration.test.mjs
git commit -m "feat: add release self-update to installer"
```

### Task 5: Documentation, workflow wording, and changelog

**Files:**
- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `references/update.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-11-release-self-update-design.md` to record the implementation-discovered reuse of the existing stable-update modules and installed-root target default.
- Test: existing documentation/reference/eval suite through `npm run check`.

**Interfaces:**
- Public update command is `node scripts/install-skill.mjs --update` / `--update --apply`.
- `node scripts/update-skill.mjs` remains documented only as a compatibility entrypoint, not a second security model.

- [ ] **Step 1: Update the README common path.**

Add a concise section after install showing:

```bash
cd ~/.agents/skills/github-delivery
node scripts/install-skill.mjs --update
node scripts/install-skill.mjs --update --apply
```

State that dry-run is default, only verified published stable releases are eligible, local modifications block replacement, and an installed version ahead of the latest published release is a no-op.

- [ ] **Step 2: Expand `INSTALL.md` with the verification chain and recovery semantics.**

Document asset digest + `SHA256SUMS` + manifest + tag/source commit + constrained GitHub attestation + strict ZIP validation, GitHub CLI requirement for attestation, backup path/restore behavior, target inference, explicit `--target` for nonstandard locations, and hook-trust invalidation after changed definitions.

- [ ] **Step 3: Update `references/update.md` to route the natural-language update workflow through the new installer flag.**

Preserve the current requirements to inspect local modifications, preserve config, and review new configuration options after an update.

- [ ] **Step 4: Add an `Unreleased` changelog entry without changing package version `0.4.0`.**

Release version bump remains a later release-preparation action.

- [ ] **Step 5: Update the design spec only for implementation-discovered structure.**

Record that the existing `stable-release-update.mjs`/`update-skill.mjs` surface was discovered and reused, and that implicit update target is the bundle owning the running installer. Do not weaken any approved acceptance criterion.

- [ ] **Step 6: Run documentation/eval checks GREEN.**

Run: `npm run check`

- [ ] **Step 7: Commit.**

```bash
git add README.md INSTALL.md references/update.md CHANGELOG.md docs/superpowers/specs/2026-08-11-release-self-update-design.md
git commit -m "docs: document verified self-update"
```

### Task 6: Final security review, exact-head verification, and PR

**Files:**
- Review all branch changes.
- Create/update the pull request from `release-self-update` to `main`.

- [ ] **Step 1: Run the complete unit suite and repository aggregate check on the final head.**

Run: `npm test` and `npm run check` when local execution is available. In the browser/GitHub-only environment, use the branch PR CI matrix as the exact-head execution evidence.

- [ ] **Step 2: Re-read the final diff specifically for supply-chain and archive bugs.**

Check:

- all network destinations stay HTTPS;
- response-size limits are enforced before unbounded allocation;
- release asset names cannot be duplicated/ambiguous;
- asset/checksum/manifest/tag/attestation identities all bind the same version/source commit;
- ZIP traversal, duplicate paths, symlinks/special files, central/local-header mismatch, unsupported compression/features, bounds, CRC, file hashes and byte counts all fail closed;
- no temporary release files survive cleanup;
- no local modifications are overwritten;
- no update path sets `allowDowngrade` or turns `--force` into a self-update bypass;
- user config and hook trust are not silently changed;
- errors do not dump tokens or arbitrary remote bodies.

- [ ] **Step 3: Open a PR with a body describing the prior updater gap and the new trust chain.**

Include TDD RED evidence and state that `scripts/update-skill.mjs` is retained as a compatibility wrapper.

- [ ] **Step 4: Verify the exact PR head through all required workflows.**

Required successful evidence:

```text
CI Node 22 / Ubuntu
CI Node 24 / Ubuntu
CI Node 22 / Windows
CI Node 24 / Windows
CI Node 22 / macOS
CI Node 24 / macOS
Architecture Contracts
CodeQL JavaScript/TypeScript
CodeQL C#
Dependency Review
```

- [ ] **Step 5: If any check fails, fix through a new RED/GREEN cycle rather than weakening the verification contract.**

- [ ] **Step 6: Inspect review threads and final diff again after the last code change.**

- [ ] **Step 7: Update the PR body with the exact final head and green workflow IDs. Do not merge without an explicit user merge instruction.**
