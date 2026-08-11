# npx bootstrap and guided setup design

Status: Approved in chat, pending written-spec review

## Goal

Add a public npm CLI entrypoint so a user can install, finish setup, diagnose, and update `github-delivery` without cloning the repository or manually locating installer scripts.

The primary onboarding command is:

```text
npx github-delivery
```

Bare invocation launches a guided setup flow. Explicit commands remain available for repeatable use:

```text
npx github-delivery install
npx github-delivery setup
npx github-delivery update
npx github-delivery update --apply
npx github-delivery doctor
```

The npm package is a thin bootstrap and guided CLI. The published GitHub Release remains the single authoritative skill payload and the existing installer remains the single mutation boundary.

## Non-goals

- Publishing a second independently authoritative skill payload through npm.
- Reimplementing release verification inside a separate npm-only installer.
- Replacing the existing backup, restore, hook, watchdog, or update machinery.
- Automatically bypassing Codex hook trust.
- Automatically changing GitHub authentication.
- Silently changing persistent user configuration.
- Global PATH rewriting.
- An uninstall command in v1.
- A non-interactive `--yes` mode in v1.

## Architecture

The public path is:

```text
npx github-delivery
  -> npm CLI/bootstrap
  -> fixed upstream Wibias/github-delivery latest stable GitHub Release
  -> shared release acquisition + verification layer
  -> existing installation/update planner
  -> existing installer / backup / hooks / watchdog
  -> post-install verification
```

npm is the launcher and bootstrap distribution point only. It is not the source of truth for the installed skill payload.

The bootstrap must not copy an npm-packaged skill tree directly into the installation target. Initial install and update both consume a separately verified published GitHub Release from the fixed upstream repository.

## Shared verified release acquisition

The release self-update implementation introduced in PR #218 currently combines two responsibilities:

1. acquire and verify the latest stable release payload;
2. compare that release against an already installed manifest and produce an update plan.

The npm bootstrap needs the first responsibility for fresh installs where no installed manifest exists.

Refactor the release layer so verification is reusable without requiring an installation target:

```text
acquireVerifiedReleasePayload({ workspace, ...dependencies })
  -> {
       verified: true,
       release,
       manifest,
       source
     }
```

`source` is the verified extracted `github-delivery` directory in the private temporary workspace.

The existing update orchestration then builds on that primitive:

```text
prepareVerifiedReleaseCandidate({ target, workspace, ...dependencies })
  -> acquireVerifiedReleasePayload(...)
  -> planStableUpdate(...)
  -> {
       verified: true,
       release,
       manifest,
       source,
       plan
     }
```

This keeps exactly one network, checksum, manifest, tag, attestation, ZIP, and extracted-file verification chain for both fresh install and update.

## Release trust requirements

The npm bootstrap must preserve the complete release verification contract already implemented for self-update:

- fixed upstream repository `Wibias/github-delivery`;
- published, non-draft, non-prerelease strict `vX.Y.Z` release only;
- exactly one version-matching ZIP, `manifest.json`, and `SHA256SUMS`;
- GitHub `sha256:` asset digests verified when exposed;
- strict `SHA256SUMS` verification;
- strict distribution-manifest identity and path validation;
- exact release-tag to `manifest.sourceCommit` binding, including bounded annotated-tag peeling;
- constrained `gh attestation verify` against repository, release workflow, exact tag ref, and source commit;
- no checksum-only fallback when attestation verification is missing or fails;
- strict bounded ZIP extraction and full extracted-file rehash/size verification;
- private temporary workspace cleanup on success and failure.

No npm command may reach the existing installer until this verification chain has completed successfully.

## npm package shape

The repository package becomes a publishable public CLI package instead of the current private package.

Expected package metadata includes:

```json
{
  "name": "github-delivery",
  "bin": {
    "github-delivery": "./scripts/github-delivery-cli.mjs"
  }
}
```

Additional packaging requirements:

- Node.js engine support remains `^22 || ^24`;
- publish only an explicit allowlist of bootstrap/runtime files needed by the CLI;
- include repository, license, description, and package metadata suitable for npm;
- avoid runtime dependencies where practical;
- no `preinstall`, `install`, or `postinstall` lifecycle scripts;
- package execution itself does not mutate a skill installation before the user approves the shown plan;
- package contents are not treated as the trusted skill release payload.

Before the first real publish, the release process must verify that the exact npm package name `github-delivery` can be published by the repository owner. If the name cannot be claimed, that is a release-blocking condition rather than a silent rename.

## CLI surface

### Bare invocation

```text
npx github-delivery
```

Bare invocation is equivalent to guided onboarding. It detects whether a valid installation already exists and chooses the appropriate guided flow.

Fresh machine:

```text
npx github-delivery
  -> environment checks
  -> host/target selection
  -> verified release acquisition
  -> install dry-run
  -> planned changes
  -> explicit apply confirmation
  -> install
  -> setup/activation guidance
  -> final verification summary
```

Existing installation:

```text
npx github-delivery
  -> inspect installation
  -> offer Update / Repair setup / Exit
```

It must never silently reinstall over an existing installation.

### `install`

```text
npx github-delivery install
```

`install` performs the fresh-install workflow explicitly.

It:

1. checks prerequisites;
2. detects supported hosts and existing installation candidates;
3. chooses or accepts an installation target;
4. acquires and fully verifies the latest stable GitHub Release;
5. calls the existing installer in dry-run mode using the verified extracted source;
6. shows all planned target/hook/watchdog changes;
7. asks for explicit confirmation;
8. calls the existing installer with `apply: true` only after confirmation;
9. verifies the installed manifest and tracked files against the separately verified release manifest;
10. continues into setup/activation guidance.

The user must be able to exit after the dry-run with no installed-skill mutation.

### `update`

```text
npx github-delivery update
npx github-delivery update --apply
```

`update` delegates to the same verified update path introduced in PR #218.

Default `update` is check/verify/plan only. `--apply` performs the existing verified backup/replacement/postcondition path.

The npm CLI does not create a second updater.

Current-version and already-ahead installations remain no-op states. A newer release plus local tracked modifications is blocked. `--force` is not exposed as a self-update bypass.

### `setup`

```text
npx github-delivery setup
```

`setup` is a repair/finish-activation workflow, not an installer and not an updater.

It inspects the existing installation and host state, then guides the user through unresolved activation work such as:

- Codex hooks configured but not yet trusted;
- activation receipt not refreshed after trust;
- supported watchdog mode not active;
- GitHub CLI/authentication missing for workflows that require it;
- installed configuration unreadable or invalid.

For Codex hook trust, the CLI may explain the exact required `/hooks` action but must not bypass or fake the trust decision.

If the exact hook definition is already trusted and unchanged, `setup` may invoke the existing same-version activation-refresh path with the corresponding verified trust assertion.

### `doctor`

```text
npx github-delivery doctor
```

`doctor` is read-only with respect to the installed skill and reports:

- Node.js support;
- Git availability;
- GitHub CLI availability;
- GitHub authentication status where determinable without changing credentials;
- detected installation path;
- installed version;
- latest stable release version;
- installed manifest integrity;
- local tracked modifications;
- persistent config readability;
- Codex hook configuration state;
- hook trust/activation status that can be established from existing receipts/configuration;
- watchdog mode;
- update availability.

A failed check must produce an actionable result instead of silently repairing it.

## Guided onboarding UX

The wizard should be compact and terminal-native. No heavy TUI dependency is required for v1.

Example shape:

```text
GitHub Delivery Setup

Environment
✓ Node.js 24
✓ Git
✓ GitHub CLI
✓ GitHub authentication

Detected hosts
✓ Codex
○ Claude
○ Cursor

Install target
> ~/.agents/skills/github-delivery

Security verification
✓ Stable release found
✓ Release provenance verified
✓ Manifest verified
✓ Archive verified

Planned changes
• Install github-delivery vX.Y.Z
• Configure supported Codex watchdog hooks
• Preserve persistent user configuration
• Create a backup when replacing an existing directory

Apply these changes? [y/N]
```

Rules:

- confirmation defaults to No;
- no target mutation before confirmation;
- verification may download into a private temporary workspace before confirmation;
- user can inspect the plan before applying;
- cancellation removes temporary files and leaves the target unchanged;
- errors identify the failed prerequisite or verification class without dumping secrets or arbitrary remote payloads.

## Host and target handling

The wizard may detect known host installations to improve guidance, but it must not invent support guarantees from directory presence alone.

Default fresh-install target remains the repository's standard Agent Skills location:

```text
~/.agents/skills/github-delivery
```

The user may choose a supported alternative/custom target. The selected target is passed to the existing installer rather than implemented by a separate copy routine.

For existing installations, the CLI should prefer a valid installed manifest over heuristic directory detection.

## Existing installation behavior

Bare invocation must distinguish at least:

- no installation found;
- valid installation found;
- multiple plausible installations found;
- path exists but is not a valid `github-delivery` installation.

For a valid existing installation, bare invocation offers:

```text
Update
Repair setup
Exit
```

It does not silently choose Update.

If multiple valid installations are found, the wizard requires the user to select the target before any update/setup action.

## Safety and mutation boundaries

The npm CLI is not allowed to directly implement:

- release extraction into the final target;
- target replacement;
- backup rotation;
- restore;
- hook-file mutation;
- watchdog activation receipt semantics.

Those remain owned by the existing installer and related modules.

The CLI may orchestrate those operations only through their existing exported interfaces after prerequisite and trust checks pass.

## Persistent user configuration

Fresh install must not silently create non-default user preferences beyond what the existing installer/setup contract requires.

Update continues to require persistent user configuration to remain unchanged across replacement.

Setup may explain available settings, but changing optional settings requires explicit user intent.

## Publishing

The npm publish path belongs in the existing release workflow rather than a separate manual process.

The preferred security model is npm Trusted Publishing from the repository's GitHub Actions release workflow so a long-lived npm publish token is not required.

Publishing requirements:

- publish only after the release validation/build gates pass;
- package version must equal the release/tag version;
- package contents must be reproducible/inspectable before publish;
- npm publication failure must fail the release publication job rather than be reported as a successful complete release;
- GitHub Release remains the authoritative installed payload even though the bootstrap package shares the same version;
- no automatic npm publication from arbitrary branches or pull requests.

The exact trusted-publisher configuration is an operator/repository setup prerequisite and cannot be self-created by package code.

## Release/version semantics

The npm bootstrap package and GitHub Delivery release use the same semantic version.

For release `vX.Y.Z`:

```text
package.json version = X.Y.Z
npm github-delivery version = X.Y.Z
GitHub Release tag = vX.Y.Z
verified skill manifest version = X.Y.Z
```

A mismatch blocks publication.

## Error handling

Representative failures include:

- unsupported Node version;
- Git unavailable;
- GitHub CLI unavailable when attestation verification requires it;
- GitHub authentication unavailable for an operation that requires it;
- npm package name not publishable during release setup;
- latest stable release unavailable or malformed;
- release verification/attestation/archive failure;
- invalid or ambiguous install target;
- existing local modifications blocking replacement;
- installer preflight failure;
- hook trust still required;
- post-install manifest/config verification failure.

Failures before installer apply are non-mutating with respect to the installed skill.

If an applied operation creates a backup and a postcondition later fails, the CLI surfaces the backup path exactly as the existing installer/update contract does.

## Testing strategy

Tests are deterministic and offline unless explicitly testing the release workflow in GitHub Actions.

### CLI parsing/dispatch

Cover:

- bare invocation routes to guided onboarding;
- `install`, `setup`, `update`, and `doctor` dispatch;
- unknown commands/flags fail clearly;
- `update --apply` forwards apply intent;
- no v1 `--yes` or uninstall behavior.

### Verified acquisition reuse

Cover:

- fresh install can acquire a verified release without an installed target;
- update candidate planning reuses the same acquisition primitive;
- release verification failure never reaches installer planning/apply;
- temporary workspace cleanup on success/cancel/failure.

### Guided install

Cover:

- fresh install dry-run occurs before confirmation;
- declined confirmation leaves target unchanged;
- accepted confirmation calls the existing installer with verified source and selected target;
- post-install manifest verification is required;
- existing valid install does not silently reinstall;
- ambiguous multiple installs require target selection.

### Setup

Cover:

- missing installation reports actionable failure;
- configured-but-untrusted hooks produce trust guidance without bypass;
- unchanged trusted hooks can use the existing activation-refresh path;
- setup does not replace the skill payload.

### Doctor

Cover:

- healthy installation summary;
- unsupported Node;
- missing Git/gh;
- manifest drift;
- invalid config;
- update available/current/ahead states;
- doctor performs no target mutation.

### npm package

Cover:

- package has the expected `bin` entry;
- npm pack contains only the approved allowlist;
- executable CLI file is included;
- no lifecycle install scripts;
- package version/release version consistency;
- packed CLI can execute from an isolated temporary directory without a repository checkout.

### CI/release

Cover:

- package dry-pack validation before publish;
- publication only on the protected release path;
- version/tag mismatch blocks publish;
- existing release attestations and release bundle checks remain intact;
- final CI matrix, architecture contracts, dependency review, and CodeQL remain green.

## Documentation

After implementation and verification, update:

- `README.md` to make `npx github-delivery` the primary installation path;
- `INSTALL.md` with guided and explicit command flows;
- `references/update.md` to mention `npx github-delivery update` as the common user-facing entrypoint while documenting the same underlying trust chain;
- `CHANGELOG.md` under the unreleased release section;
- release/publishing documentation with npm Trusted Publishing setup requirements.

The existing direct script commands remain documented as advanced/local fallback interfaces rather than being removed.

## Acceptance criteria

The feature is complete when all of the following are true:

1. `npx github-delivery` launches guided onboarding from a clean machine without a repository checkout.
2. `npx github-delivery install` performs a verified GitHub Release install through the existing installer and asks before mutation.
3. Fresh install and update share one release acquisition/verification implementation.
4. npm is not treated as the authoritative installed skill payload.
5. Existing installs are detected and not silently reinstalled by bare invocation.
6. `npx github-delivery setup` can finish/repair supported activation state without replacing the payload or bypassing hook trust.
7. `npx github-delivery update` is dry-run by default and `--apply` reaches the existing verified self-update path.
8. `npx github-delivery doctor` is read-only and reports installation, integrity, prerequisite, hook/watchdog, config, and update state.
9. No v1 command silently changes GitHub authentication, optional user settings, global PATH, or hook trust.
10. The npm package has an explicit `bin`, a minimal publish allowlist, no lifecycle install scripts, and executes from outside a repository checkout.
11. npm and GitHub release versions are identical and mismatches block publication.
12. npm publishing is integrated into the protected release workflow with trusted-publisher configuration as a repository prerequisite.
13. Existing backup, restore, hook, watchdog, and post-install verification boundaries remain authoritative.
14. README/INSTALL/update docs are updated only after the implementation and exact-head verification match the documented behavior.
15. Repository CI, architecture contracts, dependency review, and CodeQL are green on the final PR head.
