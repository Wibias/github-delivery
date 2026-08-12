# Authority Host Release Integration + Settings Design

## Goal

Ship the Windows Delivery Authority host as a first-class, versioned release component and make its three protection modes configurable from the Control Center GUI, so a normal github-delivery upgrade cannot leave the skill on a new version while the authority executable remains on an old GUI/build.

## Problem

The stable github-delivery release payload already contains `authority-host/windows` source, but `npx github-delivery update --apply` only replaces the installed skill directory. The separately installed executable under `%LOCALAPPDATA%\GitHubDeliveryAuthority` is not upgraded, because the source installer `authority-host/windows/install.ps1` is never invoked by the stable update path.

That creates a split installation:

- skill version can be current;
- Windows Authority host can remain an older binary indefinitely;
- the user can therefore still see the old approval GUI after upgrading github-delivery.

The new WinUI Control Center also advertises a `Settings` destination and shows the current protection mode, but there is no functional settings content that lets the user change `authorityMode`.

## Chosen approach

Treat the Windows Authority host as a separately built, separately verified asset of the same GitHub Release.

A release publishes both:

- the existing portable github-delivery skill archives;
- a self-contained Windows x64 Authority host archive built from the exact same tagged commit.

The npm package remains a thin bootstrap. It does not contain the Authority host binary.

The Authority host asset is installed or upgraded only on supported Windows systems, using the verified stable GitHub Release as the source of truth.

## Release artifact contract

For release version `X.Y.Z`, publish:

- `github-delivery-authority-vX.Y.Z-win-x64.zip`
- `github-delivery-authority-vX.Y.Z-win-x64.json`

The JSON metadata has this shape:

```json
{
  "schemaVersion": 1,
  "kind": "github-delivery/authority-host-release",
  "version": "X.Y.Z",
  "sourceCommit": "<40-char tagged commit sha>",
  "platform": "win32",
  "arch": "x64",
  "archive": "github-delivery-authority-vX.Y.Z-win-x64.zip",
  "sha256": "<64-char sha256>"
}
```

The archive contains the self-contained WinUI publish output and an installed metadata file named `authority-host-version.json` with the same version/source/platform identity.

The release workflow must attest the Authority host archive with the same `release.yml` workflow identity, tag ref, and source commit used for the skill release. The updater must verify:

1. stable non-draft/non-prerelease release;
2. exact versioned asset names;
3. GitHub asset digest when exposed;
4. metadata schema/version/platform/arch;
5. archive SHA-256 against metadata;
6. tag -> source commit equality;
7. metadata source commit equality;
8. GitHub artifact attestation constrained to `Wibias/github-delivery/.github/workflows/release.yml`, the exact tag, and the exact source commit;
9. bounded ZIP extraction with no traversal/symlink/path confusion.

No unverified Authority binary may be installed.

## Build and release architecture

`release.yml` gains a Windows job that checks out the exact tagged source, installs .NET 8, reads the version from `package.json`, and publishes `GitHubDeliveryAuthority` self-contained for `win-x64`.

The build stamps the host with the same semantic version as `package.json` and produces the archive + metadata above. The result is uploaded as a workflow artifact.

The protected `publish` job depends on both the existing release validation and the Authority-host build. It downloads the Authority artifact, attests the Authority archive, publishes npm as today, and attaches the Authority assets alongside the existing skill assets to the GitHub Release.

The source-level `authority-host/windows/install.ps1` remains supported for repository development, but stable user install/update must not require a local .NET SDK.

## Stable install/update behavior

Add a Node-side Authority host component manager used by `npx github-delivery setup`, `doctor`, and stable `update --apply`.

### Detection

The canonical installed host directory remains:

```text
%LOCALAPPDATA%\GitHubDeliveryAuthority
```

A host is considered installed only when the executable and `authority-host-version.json` are both present and valid. Legacy installs without metadata are detected as `legacy/unversioned` and are eligible for replacement.

### Install decision

- `authorityMode = off` and no Authority host installed: do not install it.
- `authorityMode = high-assurance` or `all` and host missing: install the verified Authority asset during setup.
- Host already installed, regardless of current mode: stable `update --apply` upgrades it to the same stable version as the skill when an update is being applied.
- Host version already equal to the stable release: no-op.
- Host version ahead of the stable release: do not downgrade automatically; report `already_ahead`.
- Unsupported OS/architecture: do not try to install; report an explicit diagnostic when protection requires the host.

### Replacement safety

The release installer stages the verified archive before touching the live host.

When replacing an existing host:

1. preserve `authority.db` and `trust-store.json` as authority state, not release files;
2. stop only a `GitHubDeliveryAuthority` process whose executable path is inside the canonical install directory;
3. replace release-owned files from the staged verified archive;
4. recreate/repair the per-user Startup shortcut and user environment variables;
5. restart the host without forcing first-run repository setup when preserved state is already valid;
6. verify the installed `authority-host-version.json` matches the intended release;
7. surface a hard failure if replacement cannot be verified.

The host update must never delete the authority database, trust store, private-key backing state, or the persistent github-delivery user config.

## Update transaction semantics

The stable updater verifies both the skill payload and, when needed, the Authority host payload before beginning mutation.

If only the skill needs updating, behavior stays unchanged.

If the installed Authority host also needs updating, the updater performs the skill replacement and Authority replacement as one requested update operation and returns component-specific results. Failure of the Authority replacement is not reported as a clean fully-updated state; `doctor` must surface the mismatch explicitly.

The existing skill backup remains available for skill rollback. The Authority installer stages replacement and preserves local state; it must not claim success until the installed metadata verifies.

## Control Center Settings

The Control Center gets a real Settings view reachable from the left navigation and the existing `Open settings` button.

The page presents exactly three protection choices:

- **Off** (`off`) — No Windows Hello prompts. Normal github-delivery mutation policy still applies.
- **Sensitive actions** (`high-assurance`) — Recommended. Require Windows Hello for intrinsically high-assurance and autonomous execution, including protected pushes/merges.
- **Every GitHub write** (`all`) — Require Windows Hello for every executed GitHub mutation.

The currently stored mode is selected on load. `Apply` writes the same `%LOCALAPPDATA%\github-delivery\config.json` used by the Node CLI. There is one source of truth.

C# `UserConfigStore` gains validated atomic write support matching the Node config schema. Invalid modes are rejected. The GUI must not silently rewrite configuration on view/open; only explicit Apply changes it.

Changing the mode in the GUI preserves the current policy semantics: it is an explicit local user configuration action, and this PR does not add a new Windows Hello gate around config changes because the existing CLI config path does not require one either.

## Version/status reporting

Control Center Settings/Diagnostics shows:

- github-delivery Authority host version;
- source commit (short form is fine in the UI);
- current stored protection mode;
- effective mode warning when an environment-variable override changes the effective value;
- Authority host readiness / legacy-unversioned state when applicable.

`npx github-delivery doctor` reports at least:

```json
{
  "authorityHost": {
    "supported": true,
    "installed": true,
    "version": "X.Y.Z",
    "sourceCommit": "...",
    "relation": "already_current",
    "requiredByMode": true,
    "error": null
  }
}
```

`relation` uses `missing`, `legacy`, `update`, `already_current`, or `already_ahead` where applicable.

## GUI navigation

`NavigationView.SelectionChanged` switches the content between the existing dashboard and the Settings view. The existing `Open settings` button selects Settings and therefore renders the Settings content. This PR does not need to invent separate new screens for Activity/Allowlist/Temporary grants/Diagnostics beyond preserving their current dashboard behavior; the required functional navigation addition is Settings.

## Backward compatibility

- Existing `authorityMode` values and environment overrides keep their semantics.
- Existing authority DB/trust-store locations remain unchanged.
- Existing named pipe remains `github-delivery-authority-v1`.
- Existing direct source installer remains available to developers.
- Stable install/update on non-Windows systems remains unaffected.
- `off` remains the persistent default.
- A legacy Authority host installation can be upgraded without resetting its allowlist or key material.

## Failure handling

Fail closed for verification failures, malformed component metadata, unexpected archive content, source/tag mismatch, attestation failure, or post-install version mismatch.

Do not silently install an Authority host on a user who has `off` selected and has never installed the component.

Do not report the system as fully current when the skill and an already-installed/required Authority host are on different stable versions.

## Tests

Add/extend tests for:

- release workflow publishes and attests the Authority asset;
- Authority metadata validation and exact release/source binding;
- download limits and malicious ZIP/path rejection;
- host detection including legacy installs;
- install decision matrix for `off`, `high-assurance`, `all`;
- no downgrade and same-version no-op;
- state-file preservation during replacement;
- `doctor` component status;
- Settings navigation actually renders settings content;
- all three GUI mode choices map to the existing internal values;
- C# config writes are validated and atomic;
- old WinForms approval classes remain excluded from the compiled WinUI app;
- existing mutation/authority semantics remain unchanged.

## Out of scope

- macOS/Linux authority host implementations;
- changing the three authority-mode semantics;
- changing repository allowlist rules;
- changing branch-lease semantics;
- changing mutation policy or which actions are intrinsically high-assurance;
- bundling the Windows binary into the npm package.
