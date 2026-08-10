# Update github-delivery

Use this workflow when the user asks to update or upgrade github-delivery.

## Source of truth

Update from the **latest stable GitHub Release** of `Wibias/github-delivery` only.

- Never update from `main` as a fallback.
- Ignore draft and prerelease releases.
- If no stable release exists, report `stable_release_not_found` and stop.

## Procedure

1. Read the current configuration with `node scripts/github-delivery-config.mjs --show`.
2. Run `node scripts/update-skill.mjs` first as a dry-run plan.
3. If it reports local modifications or locally created files inside the installed skill, do not overwrite them. Show the affected paths and ask how the user wants to proceed.
4. If the install is clean and an update is available, run `node scripts/update-skill.mjs --apply`.
5. The updater verifies release checksums before replacement and verifies that the persistent user config is unchanged afterward.
6. After updating, inspect the new `references/configuration.md` and supported config schema. Compare them with the existing config. If the release introduces new options, defaults, migrations, or recommended settings, explain them and ask before changing anything.
7. Verify the new installed version and effective config.

Do not silently reset user settings. Do not silently delete or replace local user-created files. Do not opt the user into a newly introduced setting merely because the new release supports it.
