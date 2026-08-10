# Setup, Settings, and Stable Update Plan

**Goal:** Make installation, configuration, and stable-release updates first-class natural-language workflows while preserving user configuration and local modifications.

## Contracts

- Setup/settings/update are routed read-only workflows; local configuration writes are not GitHub mutations.
- `github-delivery-config.mjs` shows and changes the canonical persistent config from PR #189.
- Update source is the latest non-draft, non-prerelease GitHub Release only. Never fall back to `main`.
- If no stable release exists, fail with `stable_release_not_found`.
- Before replacement, compare every file recorded by the installed `manifest.json` with its current installed bytes. Missing or changed tracked files are local modifications and block unattended replacement.
- Config/state outside the installed skill is never overwritten.
- New config keys/defaults are reported after update and never silently opted into.
- README/INSTALL expose copy/paste prompts for Setup, Settings, and Update.

## Tasks

- [ ] Add RED unit contracts for config CLI, updater planning, routing, and documentation.
- [ ] Implement config command module + CLI.
- [ ] Implement stable release/update planner and CLI using release manifest/checksums.
- [ ] Add setup/configuration/update routing references.
- [ ] Add README/INSTALL prompt-first documentation.
- [ ] Run full repository checks and exact-head CI.
