# Install github-delivery

The public interface remains natural language after installation, for example:

```text
merge PR #32
```

The scripts below are maintainer and installation tooling, not the normal way to use the skill.

## Requirements

- Node.js 22 or 24
- Git
- GitHub network access
- An authenticated GitHub CLI or a host-provided brokered connector for GitHub writes

## Build a release bundle

```bash
npm run dist:check
```

This creates `dist/github-delivery/`, ZIP and tar.gz archives, `manifest.json`, and `SHA256SUMS`. The reproducibility check performs two isolated builds and rejects any byte difference.

## Dry-run installation

The installer defaults to `~/.agents/skills/github-delivery` and does not modify the target unless `--apply` is provided:

```bash
node scripts/install-skill.mjs
```

Choose another host directory explicitly when needed:

```bash
node scripts/install-skill.mjs --target ~/.cursor/skills/github-delivery
node scripts/install-skill.mjs --target ~/.claude/skills/github-delivery
node scripts/install-skill.mjs --target ~/.codex/skills/github-delivery
```

## Apply an install or upgrade

```bash
node scripts/install-skill.mjs --apply
```

Existing directory installations are backed up before replacement. Symlinks and non-skill directories fail closed unless the operator inspects the plan and explicitly supplies `--force`. Downgrades require `--allow-downgrade`.

## Update an installed skill from the latest stable release

You do not need a repository checkout to update an already installed release. Run the installer that is inside the installed bundle:

```bash
cd ~/.agents/skills/github-delivery
node scripts/install-skill.mjs --update
node scripts/install-skill.mjs --update --apply
```

The first command is a dry-run. It discovers and fully verifies the latest published stable `Wibias/github-delivery` GitHub Release, compares it with the installed copy, and prints the update plan without replacing the installed skill. On supported Windows systems it also reports the separately installed Authority-host component plan. Add `--apply` only after inspecting that plan.

Unless `--target` is explicitly provided, release self-update targets the root of the installed bundle that is executing `install-skill.mjs`. The compatibility command below reaches the same implementation and security boundary:

```bash
node scripts/update-skill.mjs
node scripts/update-skill.mjs --apply
```

The compatibility wrapper does not contain its own downloader or installer. It forwards to `install-skill.mjs --update`.

### What is eligible

Self-update accepts only the latest published, non-draft, non-prerelease release from the fixed upstream repository, with a strict `vX.Y.Z` tag. It never falls back to `main`, another branch, a fork, an arbitrary URL, or GitHub's generated source archive.

Self-update never downgrades the installed skill. An installed skill newer than the latest published stable release is a complete no-op, including Authority reconciliation. If the skill itself is already current, `--update --apply` may still repair or update an installed/required Windows Authority host that is stale or legacy. A versioned Authority host newer than stable is never automatically downgraded. `--update` rejects `--source`, `--restore`, and `--allow-downgrade` so those separate local install/recovery controls cannot weaken release provenance.

### Verification before replacement

The downloaded release is not trusted merely because it came from a GitHub Release page. Before the existing installer can replace anything, self-update requires the complete skill chain below:

1. Valid latest-stable Release metadata and exactly one version-matching ZIP, `manifest.json`, and `SHA256SUMS` asset.
2. GitHub `sha256:` asset-digest verification for each required asset when GitHub exposes a digest.
3. Strict `SHA256SUMS` verification of the ZIP and separately downloaded manifest.
4. Strict distribution-manifest validation, including repository identity, release version, source commit, file hashes, sizes, modes, uniqueness, and safe relative paths.
5. GitHub tag resolution, including bounded annotated-tag peeling, with the final commit required to equal `manifest.sourceCommit`.
6. `gh attestation verify` for the ZIP, constrained to repository `Wibias/github-delivery`, signer workflow `Wibias/github-delivery/.github/workflows/release.yml`, the exact `refs/tags/vX.Y.Z` source ref, and the resolved source commit. There is no checksum-only fallback if attestation verification is unavailable or fails.
7. Strict ZIP extraction into a private temporary directory. Traversal, absolute/Windows paths, links, unsupported entry types/compression, duplicates, undeclared or missing files, manifest-byte mismatches, CRC failures, unsafe destinations, and configured expansion limits fail closed.
8. Rehashing and byte-count verification of every extracted manifest file before that directory can become an installation source.
9. Comparison of the current installed payload with its installed manifest. Local tracked modifications block replacement, and `--force` does not bypass this self-update guard.

Stable GitHub Releases also publish a separately versioned self-contained Windows Authority-host archive plus metadata. When the Authority component needs installation/repair/update, the updater additionally requires exact versioned asset identity, Windows/x64 metadata, metadata SHA-256 equality, the same exact tagged source commit, GitHub asset digest when available, a `release.yml` attestation bound to the same tag/source, and strict bounded Authority ZIP extraction. No unverified Authority binary is installed.

Redirects remain HTTPS-only and downloads are size bounded. Verification failures occur before the corresponding installed component is replaced.

### Apply, backup, Authority state, and recovery

For a clean, strictly newer verified skill release, `--update --apply` passes the verified extracted directory into the existing installer. The existing backup and replacement implementation remains authoritative rather than introducing a second skill mutation path.

After replacement, self-update verifies that the installed `manifest.json` is exactly the verified release manifest, rechecks every tracked file, and rereads persistent user configuration. The user configuration must remain unchanged.

On Windows, the same update operation then reconciles the Authority component when required or already installed. Its verified release runtime is installed beneath `%LOCALAPPDATA%\GitHubDeliveryAuthority\app\vX.Y.Z`; the root `authority-host-install.json` selects the active version. `authority.db`, `trust-store.json`, and `%LOCALAPPDATA%\github-delivery\config.json` are persistent state and are not release-owned files, so Authority replacement preserves them. A configured install whose executable is missing is repaired rather than mistaken for a deliberate absence.

If the effective protection mode is `off` and Authority has never been installed, setup/update does not download or install the component. If Authority is already installed, stable update keeps it aligned even while mode is `off`. A host ahead of stable remains untouched.

If skill replacement succeeded but a post-install verification fails, the command fails instead of claiming success and reports the preserved skill backup path. Restore it with the normal restore command documented below. Authority replacement likewise fails closed until its installed version/source metadata and executable verify; `doctor` then exposes any remaining component mismatch rather than reporting a clean fully-current state.

Persistent user settings are not reset or migrated silently. After an update, inspect any new configuration options and decide explicitly whether to adopt them.

A release can also change GitHub Delivery's Codex hook definitions. Existing hook trust is valid only for the exact unchanged definition. If the update changes that definition, the resulting activation state reports `hook_trust_required` until you review and trust the new hooks through Codex's normal `/hooks` flow.

See [`references/update.md`](references/update.md) for the agent-facing update workflow and exact safety rules.

## Codex progress watchdog activation

A standard Codex install/upgrade now plans the watchdog together with the skill. When Codex is detected and lifecycle hooks are supported, `--apply` also configures GitHub Delivery's `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, and `SessionEnd` entries in `~/.codex/hooks.json`. Existing hook configuration is preserved, backed up before a change, and updated idempotently.

Codex deliberately does **not** run a new or changed non-managed command hook until you review and trust its exact definition. A fresh install therefore reports:

```text
mode: none
degradationReason: hook_trust_required
hooksConfigured: true
```

Open `/hooks` in Codex, review the GitHub Delivery hook definitions, and trust them. After that exact unchanged definition is trusted, refresh the activation receipt with the normal installer:

```bash
node scripts/install-skill.mjs --hook-trust-verified --apply
```

A same-version run with that explicit activation refresh does not reinstall or back up the skill again. It verifies that the expected hook definition is unchanged and then records `hooks` as the active mode. If the hook definition has changed, the trust assertion is rejected for activation purposes and `hook_trust_required` remains.

The installer never adds Codex's `--dangerously-bypass-hook-trust` flag by default.

The effective installation state is recorded in:

```text
~/.codex/github-delivery/watchdog-activation.json
```

The receipt contains only activation metadata. It does not contain prompts, conversations, tool inputs, bearer tokens, or other secrets.

The modes are intentionally strict:

- `stream`: a host has explicitly bound launches to GitHub Delivery's protected streaming boundary, or the current process was started by the protected launcher;
- `hooks`: the expected lifecycle hooks are configured and their unchanged definition has been explicitly confirmed trusted; this mode applies deterministic per-turn supported-tool guardrails but cannot interrupt assistant text before a local tool boundary;
- `none`: no runtime enforcement surface is verified. `hook_trust_required` distinguishes configured-but-untrusted hooks from a genuinely unavailable watchdog.

Trusted hook mode always scopes supported tool progress by `session_id + turn_id` and includes `agent_id` when Codex actually supplies it. Current `PreToolUse`/`PostToolUse` schemas do not document `agent_id`, so local tool activity without an exposed agent identifier shares one conservative evidence budget inside that turn. Exact duplicate reads and rapid repeated polls are blocked as before. Distinct reads/searches consume a consecutive evidence budget: the default soft warning appears at 8 attempts without execution/state progress, and the 12th supported evidence attempt is denied until the turn makes execution/state progress or a new turn begins. Evidence gathering itself does not reset the repeated-narration detector.

Hosted tools that do not pass through Codex's local lifecycle hooks are not claimed as hook-protected. Use the controlled streaming launcher when hard in-flight interruption and hosted App Server item visibility are required.

### Protected streaming launcher

The protected launcher is installed with the skill at:

```text
~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

Run Codex through it when you need repeated narration or a runaway evidence-exploration turn stopped while the turn is still in progress:

```bash
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

Arguments after the script are passed to remote-compatible Codex CLI modes, for example:

```bash
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs resume <SESSION>
```

The launcher starts the real Codex App Server on its normal stdio transport, exposes an authenticated loopback bridge to the Codex `--remote` client, and keeps independent watchdog state per active turn. It observes assistant-message deltas plus supported App Server item events, preserves narration history across evidence reads/searches, and can issue a private `turn/interrupt` for either a repeated no-progress narration stall or a hard evidence-budget breach. It owns `--remote` and `--remote-auth-token-env`; caller-supplied replacements are rejected so the protected boundary cannot be bypassed accidentally.

Protected stream mode fails closed. The bridge rejects a client that opts out of required watchdog notifications, detects a non-empty completed agent message that arrived without the required streaming deltas, treats router failures as fatal, and requires every private `turn/interrupt` to receive a successful acknowledgement within a bounded interval. If any of those enforcement properties fail, the bridge destroys the protected client connection and the launcher kills both Codex child processes rather than leaving a session running under a false `stream` claim.

Inside the launched App Server/client process tree, the launcher sets the runtime watchdog declaration to `stream`. That makes capability discovery describe the current protected session directly rather than relying on a stale machine-wide claim.

Installing the launcher does **not** make an ordinary `codex` or IDE process use it automatically. Codex exposes remote App Server selection as a launch option; GitHub Delivery does not replace your global `codex` executable or silently rewrite editor startup configuration. A persistent host integration may use `--stream-launch-controlled` only when it genuinely controls future launches through this boundary.

Codex currently documents `app-server` and its WebSocket transport as experimental and unsupported for production workloads. This launcher is therefore the strongest currently available Codex boundary for this failure mode, not a stable production host API. Use trusted lifecycle hooks plus the policy fallback when that experimental surface is inappropriate.

### Manual hook repair

`scripts/install-codex-watchdog-hooks.mjs` remains available as a repair or non-standard-install tool. It is dry-run by default:

```bash
node scripts/install-codex-watchdog-hooks.mjs
node scripts/install-codex-watchdog-hooks.mjs --apply
```

If the skill was installed somewhere other than `~/.agents/skills/github-delivery`, pass that path explicitly:

```bash
node scripts/install-codex-watchdog-hooks.mjs --skill-dir ~/.codex/skills/github-delivery --apply
```

Hook repair still requires Codex's normal `/hooks` review/trust flow for a new or changed non-managed hook.

See [`references/agent-progress-watchdog.md`](references/agent-progress-watchdog.md) for the enforcement boundaries and incident behaviour.

## Restore a backup

```bash
node scripts/install-skill.mjs \
  --restore ~/.agents/skills/.github-delivery-backups/github-delivery-TIMESTAMP-VERSION \
  --target ~/.agents/skills/github-delivery \
  --apply
```

## Manual installation

Extract an archive and copy the resulting `github-delivery` directory into the host's skill directory. Keep the directory name exactly `github-delivery`, because the Agent Skills specification requires it to match the `name` field in `SKILL.md`.


## Authority host environment variables

The optional Windows Authority host uses built-in defaults:

- `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE` defaults to `%LOCALAPPDATA%\GitHubDeliveryAuthority\trust-store.json`.
- `GITHUB_DELIVERY_AUTHORITY_PIPE` defaults to `github-delivery-authority-v1`.

Normal installations do not need these variables. They remain available as explicit overrides for custom installations or testing. Existing user-level values are not removed automatically.
The optional Windows 11 Authority host turns local Windows Hello approvals into short-lived, exact-scope trusted grants for high-assurance mutations. It does not automatically enable a stricter global protection mode.

For a normal stable installation, the **guided setup** is managed by the github-delivery bootstrap; do **not** build the Authority host manually. Use:

```bash
npx github-delivery setup
npx github-delivery start
npx github-delivery doctor
```

Fresh install and setup start the Authority host automatically when it is installed. Login auto-start is opt-in: accept the prompt during install or run `npx github-delivery autostart` later. Use `npx github-delivery start` to launch the GUI without changing the login setting.

Stable GitHub Releases include a separately verified self-contained Windows Authority-host asset, and the managed setup/update path does **not** require the .NET SDK. The Control Center's **Settings** page exposes **Off**, **Sensitive actions** (recommended), and **Every GitHub write**, backed by the same persistent `authorityMode` configuration used by the CLI.

A **Windows Hello PIN** is sufficient. Biometric hardware is not required when a Hello PIN is available. If Hello is missing or not configured, the setup UI can take you to **Settings > Accounts > Sign-in options** and let you check readiness again.

For repository development or a source build, use:

```powershell
.\authority-host\windows\install.ps1
```

That source/development installer requires Windows 11 build 22000 or newer and a .NET 8 SDK. After building locally it delegates deployment to the same state-preserving release installer used by the managed component path.

See [`authority-host/windows/README.md`](authority-host/windows/README.md) for the full stable lifecycle, source prerequisites, recovery, upgrade, Settings, and security behavior.

## Uninstall

Remove only the installed `github-delivery` directory. Keep its latest backup until the replacement version has completed at least one real workflow successfully. If the Windows Authority host is installed, it is a separate stateful component under `%LOCALAPPDATA%\GitHubDeliveryAuthority`; removing the skill directory does not implicitly delete its authority database, trust store, or host installation.
