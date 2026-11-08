# Setup and configuration

Use this workflow when the user asks to install, set up, show, or change github-delivery settings.

## Read current state first

1. Detect the installed skill location and prerequisites.
2. Run `node scripts/github-delivery-config.mjs --show` from the installed skill when available.
3. Explain the effective Windows Hello / trusted-authority protection mode before changing it.

## Protection choices

Present exactly these user-facing choices:

- **Off** — never require Windows Hello for github-delivery mutations. Normal github-delivery authorization and workflow rules still apply.
- **Sensitive actions** — internal value `high-assurance`; require Windows Hello for intrinsically high-assurance and autonomous execution.
- **Every GitHub write** — internal value `all`; require Windows Hello for every executed GitHub mutation.

Do not enable protection without asking the user. If the user already gave an unambiguous requested mode, do not ask again.

Apply a selected mode with:

```bash
node scripts/github-delivery-config.mjs --authority-mode off
node scripts/github-delivery-config.mjs --authority-mode high-assurance
node scripts/github-delivery-config.mjs --authority-mode all
```

On Windows, the same stored preference is available in **Control Center > Settings** as **Off**, **Sensitive actions**, and **Every GitHub write**. Both paths write the same persistent user configuration; environment-variable overrides can still make the effective mode stricter than the stored preference.

The config is global for the user's github-delivery installation and lives outside the installed skill directory.

## Local CI evidence mode (explicit opt-in, per repository)

The default required-check source is remote GitHub check evidence. If a repository cannot produce usable remote check runs (for example, an exhausted Actions quota), the user may explicitly select local evidence for that repository only:

```bash
node scripts/github-delivery-config.mjs --ci-evidence-mode local --repository OWNER/REPO --waiver "user authorization reference"
node scripts/github-delivery-config.mjs --ci-evidence-mode remote --repository OWNER/REPO
node scripts/github-delivery-config.mjs --show --repository OWNER/REPO
```

The local mode is stored in user configuration schema 2 and never read from repository files. It records the repository identity, the waiver reference, and the time of the change. Without an entry for the repository, remote checks remain authoritative.

A merge with local mode active requires a matching receipt:

```bash
node scripts/local-ci-receipt.mjs OWNER/REPO PR --log PATH\to\run.log \
  --command "npm run ci:local -- --full" --scope "full local CI"
```

The receipt binds the repository, pull request, exact head SHA, base SHA, command and suite scope, exit codes, timestamps, runner host, Node/npm/git versions, and the SHA-256 of the complete log. Receipts live under the user's github-delivery data directory, not in the repository. The merge gate stays blocked when the receipt is missing, belongs to another repository or PR, targets another head, records a non-zero exit, has a tampered log hash, was recorded before the head commit, is older than seven days, or its base is no longer part of the current base history. Remote check results remain visible as observations and advisories; they are not presented as green.

Reviews, authority grants, draft handling, branch protection, conversation resolution, and every other gate keep working unchanged. The mode only substitutes the required-check evidence source for the named repository.

## Windows Authority host

For normal stable installations, use the managed lifecycle:

```bash
npx github-delivery setup
npx github-delivery doctor
npx github-delivery update
npx github-delivery update --apply
```

Stable GitHub Releases contain a separately verified, self-contained `win-x64` Authority-host asset. Stable setup/update verifies the component's version, tagged source commit, archive digest, bounded extraction, and release-workflow attestation before installation, so users do **not** need the .NET SDK for the managed Authority install/update path.

If the effective mode is `high-assurance` or `all`, `setup` installs or repairs the verified Authority host on supported Windows systems. If the selected mode is `off` and the host has never been installed, setup/update does not install it. Once the host is already installed, stable update keeps it aligned with the skill even when the current mode is `off`; a host newer than stable is never automatically downgraded.

`authority-host/windows/install.ps1` remains the repository/development source-install path. It requires Windows 11 plus the .NET 8 SDK and delegates deployment to the same state-preserving release installer semantics after building locally.

A Windows Hello PIN is sufficient; biometric hardware is not required.

## Completion

Show:

- installed skill version/path;
- config path;
- stored and effective protection mode;
- Authority-host version/status and stable relation when applicable;
- whether the effective mode requires Authority;
- any unresolved prerequisites or diagnostics.

`doctor` is read-only and reports the skill and Authority host separately. Authority relations distinguish `missing`, `legacy`, `update`, `already_current`, and `already_ahead` where applicable.

Do not perform unrelated GitHub mutations as part of setup/configuration.
