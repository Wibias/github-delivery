# Install shipping-github

The public interface remains natural language after installation, for example:

```text
merge PR #32
```

The scripts below are maintainer and installation tooling, not the normal way to use the skill.

## Requirements

- Node.js 20 or newer
- Git
- GitHub network access
- An authenticated GitHub CLI or a host-provided brokered connector for GitHub writes

## Build a release bundle

```bash
npm run dist:check
```

This creates `dist/shipping-github/`, ZIP and tar.gz archives, `manifest.json`, and `SHA256SUMS`. The reproducibility check performs two isolated builds and rejects any byte difference.

## Dry-run installation

The installer defaults to `~/.agents/skills/shipping-github` and does not modify the target unless `--apply` is provided:

```bash
node scripts/install-skill.mjs
```

Choose another host directory explicitly when needed:

```bash
node scripts/install-skill.mjs --target ~/.cursor/skills/shipping-github
node scripts/install-skill.mjs --target ~/.claude/skills/shipping-github
node scripts/install-skill.mjs --target ~/.codex/skills/shipping-github
```

## Apply an install or upgrade

```bash
node scripts/install-skill.mjs --apply
```

Existing directory installations are backed up before replacement. Symlinks and non-skill directories fail closed unless the operator inspects the plan and explicitly supplies `--force`. Downgrades require `--allow-downgrade`.

## Restore a backup

```bash
node scripts/install-skill.mjs \
  --restore ~/.agents/skills/.shipping-github-backups/shipping-github-TIMESTAMP-VERSION \
  --target ~/.agents/skills/shipping-github \
  --apply
```

## Manual installation

Extract an archive and copy the resulting `shipping-github` directory into the host's skill directory. Keep the directory name exactly `shipping-github`, because the Agent Skills specification requires it to match the `name` field in `SKILL.md`.

## Uninstall

Remove only the installed `shipping-github` directory. Keep its latest backup until the replacement version has completed at least one real workflow successfully.
