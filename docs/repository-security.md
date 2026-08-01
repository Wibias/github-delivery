# Repository security configuration

The files in this repository define the desired security baseline. GitHub settings must still be applied by a repository administrator after the corresponding workflows have run at least once.

## Main branch ruleset

Apply `.github/repository-policy.json` to `main`:

- require pull requests and resolved conversations
- dismiss stale approvals after new commits
- reject force pushes and branch deletion
- allow merge commits only
- enable **Update branch** and auto-merge
- require the six Node CI jobs, Dependency Review, and CodeQL
- keep bypass access limited to emergency administrators

Do not require Scorecard as a pull-request check because it runs on `main`, schedules, and branch-protection changes rather than on every PR.

## Release boundary

Create an environment named `release` with at least one required reviewer. Restrict deployments to protected release tags matching `v*`. The release workflow must remain tag-only for publication; manual dispatch is validation-only.

## Repository features

Enable dependency graph, Dependabot alerts, Dependabot security updates, secret scanning, push protection, code scanning, and private vulnerability reporting when available for the repository.

## Merge settings

Enable merge commits and disable squash and rebase merges so stacked PR ancestry remains explicit. Enable auto-merge and branch updates. These settings are represented in `.github/repository-policy.json` and should be audited against live repository settings after changes.

## Verification

Run:

```text
npm run security:repo
```

The command validates workflow action pins, permission boundaries, checkout credentials, forbidden `pull_request_target` use, and the machine-readable repository policy. It does not claim that GitHub settings have been applied; live settings require a separate authenticated audit.
