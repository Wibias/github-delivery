# Setup and configuration

Use this workflow when the user asks to install, set up, show, or change github-delivery settings.

## Read current state first

1. Detect the installed skill location and prerequisites.
2. Run `node scripts/github-delivery-config.mjs --show` from the installed skill when available.
3. Explain the effective Windows Hello / trusted-authority protection mode before changing it.

## Protection choices

Present exactly these user-facing choices:

- **Off** — ordinary high-assurance writes do not require Windows Hello, but independently authenticated lifecycle intent and exact-text human replies still require the authority host/grant. Normal github-delivery authorization and workflow rules still apply.
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

## Windows Authority host

For normal stable installations, use the managed lifecycle:

```bash
npx github-delivery setup
npx github-delivery doctor
npx github-delivery update
npx github-delivery update --apply
```

Stable GitHub Releases contain a separately verified, self-contained `win-x64` Authority-host asset. Stable setup/update verifies the component's version, tagged source commit, archive digest, bounded extraction, and release-workflow attestation before installation, so users do **not** need the .NET SDK for the managed Authority install/update path.

If the effective mode is `high-assurance` or `all`, `setup` installs or repairs the verified Authority host on supported Windows systems. If the selected mode is `off` and the host has never been installed, routine stable update does not install it. Explicit `npx github-delivery setup` does provision the verified host even in Off mode so independently authenticated lifecycle intent and exact-text human replies remain usable. Once the host is installed, stable update keeps it aligned with the skill even when the current mode is `off`; a host newer than stable is never automatically downgraded.

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
