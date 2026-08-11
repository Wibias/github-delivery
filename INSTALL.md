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

## Codex progress watchdog activation

A standard Codex install/upgrade now plans the watchdog together with the skill. When Codex is detected and lifecycle hooks are supported, `--apply` also configures GitHub Delivery's `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, and `SessionEnd` entries in `~/.codex/hooks.json`. Existing hook configuration is preserved, backed up before a change, and updated idempotently.

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
- `hooks`: the expected lifecycle hooks are configured and their unchanged definition has been explicitly confirmed trusted; in-progress assistant text still cannot be interrupted before `Stop`;
- `none`: no runtime enforcement surface is verified. `hook_trust_required` distinguishes configured-but-untrusted hooks from a genuinely unavailable watchdog.

### Protected streaming launcher

The protected launcher is installed with the skill at:

```text
~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

Run Codex through it when you need the exact repeated-narration failure stopped while the assistant message is still being generated:

```bash
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs
```

Arguments after the script are passed to remote-compatible Codex CLI modes, for example:

```bash
node ~/.agents/skills/github-delivery/scripts/codex-with-watchdog.mjs resume <SESSION>
```

The launcher starts the real Codex App Server on its normal stdio transport, exposes an authenticated loopback bridge to the Codex `--remote` client, observes assistant-message deltas, and can issue a private `turn/interrupt` before a repeated no-progress message grows unbounded. It owns `--remote` and `--remote-auth-token-env`; caller-supplied replacements are rejected so the protected boundary cannot be bypassed accidentally.

Inside the launched App Server/client process tree, the launcher sets the runtime watchdog declaration to `stream`. That makes capability discovery describe the current protected session directly rather than relying on a stale machine-wide claim.

Installing the launcher does **not** make an ordinary `codex` or IDE process use it automatically. Codex exposes remote App Server selection as a launch option; GitHub Delivery does not replace your global `codex` executable or silently rewrite editor startup configuration. A persistent host integration may use `--stream-launch-controlled` only when it genuinely controls future launches through this boundary.

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

## Optional Windows authority host

The optional Windows 11 authority host turns local Windows Hello approvals into short-lived, exact-scope trusted grants for high-assurance mutations. It is not required for ordinary installation and does not automatically enable global strict-authority enforcement.

Install it from the repository root with:

```powershell
.\authority-host\windows\install.ps1
```

The installer requires Windows 11 build 22000 or newer and a .NET 8 SDK, then opens a **guided setup**. That flow checks Windows Hello readiness, runs a real verification test, asks for the first trusted repository, and requires a fresh Hello approval before the repository is allowlisted.

A **Windows Hello PIN** is sufficient. Biometric hardware is not required when a Hello PIN is available. If Hello is missing or not configured, the setup UI can take you to **Settings > Accounts > Sign-in options** and let you check readiness again.

See [`authority-host/windows/README.md`](authority-host/windows/README.md) for the full prerequisite, recovery, upgrade, and security behavior.

## Uninstall

Remove only the installed `github-delivery` directory. Keep its latest backup until the replacement version has completed at least one real workflow successfully.
