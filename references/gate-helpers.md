# Gate helpers (required checks + CODEOWNERS)

Load with the evidence sweep when claiming merge-ready, status “merge-ready”, or merge.

Resolve `<shipping-github>` to this skill’s install directory (repo root or `~/.agents/skills/shipping-github`).

## Required checks

```bash
node "<shipping-github>/scripts/required-checks.mjs" OWNER/REPO N
```

Unions:

- Classic branch protection **legacy** `contexts` and **modern** `checks[].context`
- Branch **rulesets** `required_status_checks`
- Live `statusCheckRollup` / `gh pr checks`

Exit `1` if required jobs are failing, pending, or missing (or heuristic fail when no required list exists). See **Required checks + review gate** in `shared-rules.md`.

## CODEOWNERS paths

```bash
node "<shipping-github>/scripts/codeowners-for-pr.mjs" OWNER/REPO N
```

Loads CODEOWNERS from the **PR base**, maps each changed file → owners (last match wins), lists review requests, and reports `codeowners/errors`. See **CODEOWNERS path automation** in `shared-rules.md`.
