# Live Integration setup

The **Live Integration** workflow exercises the complete GitHub lifecycle against temporary, namespaced resources. It creates an issue, branch, and pull request; observes required checks; captures ship-gate evidence; proves stale-head rejection; closes or merges the fixture pull request; and removes the branch.

## Why a dedicated credential is required

GitHub's workflow `GITHUB_TOKEN` can be granted contents, issues, pull-request, Actions, Checks, and commit-status permissions, but it cannot be granted the repository Administration read permission required for complete branch-protection and policy evidence.

The lifecycle therefore fails before mutation unless the repository Actions secret `LIVE_FIXTURE_TOKEN` is configured and passes the non-mutating capability preflight.

The ordinary workflow token remains read-only. The dedicated credential is exposed only to the preflight, lifecycle, and cleanup steps.

## Current GitHub token limitation

GitHub does not currently expose the **Checks** permission when creating a fine-grained personal access token. GitHub's REST endpoint pages still describe a fine-grained `Checks: read` permission, but GitHub's personal-access-token documentation lists the Checks API as an unsupported fine-grained-token use case.

For this public repository, use a classic personal access token with only the `public_repo` scope for the acceptance workflow. Do not select the broader `repo` scope.

A GitHub App is the preferred future option when strict single-repository scoping is required because an App can receive repository-specific Administration and Checks permissions. The classic-token path is retained here as the simplest working acceptance credential.

## Create the token

Create a classic personal access token under the maintainer account:

1. Open GitHub **Settings**.
2. Open **Developer settings**.
3. Open **Personal access tokens** → **Tokens (classic)**.
4. Choose **Generate new token (classic)**.
5. Use a descriptive note such as `github-delivery live fixture`.
6. Select a short expiration, such as 90 days.
7. Select only the `public_repo` scope.

Do not select:

- `repo`, which includes private-repository access
- `workflow`, because the fixture does not create or modify workflow files
- organization, package, hook, admin, or user scopes

A classic token cannot be restricted to one repository. Limit its lifetime, store it only as the repository Actions secret, and rotate it before expiration.

## Store the token

In `Wibias/github-delivery`:

1. Open **Settings** → **Secrets and variables** → **Actions**.
2. Choose **New repository secret**.
3. Name it exactly `LIVE_FIXTURE_TOKEN`.
4. Paste the classic token as the value.

The secret is not available to pull-request workflows. The Live Integration workflow runs only through manual dispatch or its explicitly enabled schedule on the default branch.

## Preflight behavior

Before creating any fixture resource, the workflow runs:

```bash
node scripts/verify-live-fixture-token.mjs Wibias/github-delivery --base main
```

The verifier performs read-only probes for:

- authenticated user identity
- repository visibility
- Actions workflow runs
- commit check runs
- commit statuses
- active repository rules
- GraphQL branch-protection rules

A missing or under-scoped credential fails before issue, branch, or pull-request creation. The verifier never prints the credential.

GitHub does not provide a reliable non-mutating probe for every write capability. The `public_repo` scope supplies the public-repository writes used by the fixture. Any denied write still fails the lifecycle and triggers namespaced cleanup.

## Run acceptance

After storing the secret:

1. Open **Actions** → **Live Integration**.
2. Choose **Run workflow** from `main`.
3. Keep `disposition` set to `close`.
4. If GitHub requests approval for the temporary fixture pull request workflows, approve them.
5. Confirm the lifecycle completes successfully.
6. Download the `live-fixture-<run-id>-<attempt>` artifact.

The artifact contains:

- `live-fixture-credential.json`
- `live-fixture-receipt.json`
- `live-fixture-cleanup.json`

A successful acceptance receipt has `passed: true`, records all required checks, and confirms fixture cleanup.

## Rotation

Rotate the classic token before expiration and immediately after suspected exposure. Replace the repository secret in place; no workflow change is required.
