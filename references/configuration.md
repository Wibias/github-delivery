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

The config is global for the user's github-delivery installation and lives outside the installed skill directory.

## Windows Authority host

If the selected mode is `high-assurance` or `all`, install or verify the Windows Authority host on supported Windows systems using `authority-host/windows/install.ps1`, then run its readiness/self-test path. A Windows Hello PIN is sufficient; biometric hardware is not required.

If the selected mode is `off`, do not make the authority host a prerequisite. An already installed host may remain installed for later use.

## Completion

Show:

- installed skill version/path;
- config path;
- stored and effective protection mode;
- authority-host readiness when applicable;
- any unresolved prerequisites or diagnostics.

Do not perform unrelated GitHub mutations as part of setup/configuration.
