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

## Mutation authority boundary

The broker's legacy `mutationMode`, `explicitInstruction`, and `exactTextConfirmed` request fields are caller-provided policy assertions. They help a compliant agent avoid accidental writes, but they are not independently authenticated user consent.

When the runtime host can mint authority outside the agent's control, configure `GITHUB_DELIVERY_AUTHORITY_PUBLIC_KEY` with the host's Ed25519 public key and send signed `gd1` authority grants to the mutation broker. Set `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` only in a deployment where the host actually supplies those grants. The repository never stores or mints with the corresponding private key.

Verified grants are bound to repository, action, concrete resource identifiers, expected PR head where applicable, maximum mutation mode, time window, and exact reply-body hash for human-thread replies. Invalid supplied grants fail closed instead of falling back to caller assertions.

This repository does not claim durable one-time replay protection for grants. Short TTL plus resource/head binding limits replay scope; a trusted host/service that needs one-time semantics must consume nonces outside the agent-accessible process boundary.

## Verification

Run:

```text
npm run security:repo
```

The command validates workflow action pins, permission boundaries, checkout credentials, forbidden `pull_request_target` use, and the machine-readable repository policy. It does not claim that GitHub settings have been applied; live settings require a separate authenticated audit.

For live declared-vs-GitHub drift, run:

```text
node scripts/verify-live-repository-policy.mjs OWNER/REPO
```
