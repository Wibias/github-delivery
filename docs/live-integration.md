# Live Integration setup

The **Live Integration** workflow exercises the complete GitHub lifecycle against temporary, namespaced resources. It creates an issue, branch, and pull request; observes required checks; captures ship-gate evidence; proves stale-head rejection; closes or merges the fixture pull request; and removes the branch.

## Why a dedicated credential is required

GitHub's workflow `GITHUB_TOKEN` can be granted contents, issues, and pull-request write permissions, but it cannot be granted the repository Administration read permission required for complete branch-protection and policy evidence.

The lifecycle therefore fails before mutation unless the repository Actions secret `LIVE_FIXTURE_TOKEN` is configured and passes the non-mutating capability preflight.

The ordinary workflow token remains read-only. The dedicated credential is exposed only to the preflight, lifecycle, and cleanup steps.

## Create the token

Create a fine-grained personal access token under the maintainer account:

1. Open GitHub **Settings**.
2. Open **Developer settings**.
3. Open **Personal access tokens** → **Fine-grained tokens**.
4. Choose **Generate new token**.
5. Use a descriptive name such as `shipping-github live fixture`.
6. Select a short expiration, such as 90 days.
7. Set **Resource owner** to `Wibias`.
8. Set **Repository access** to **Only select repositories**.
9. Select only `shipping-github`.

Grant these repository permissions:

| Permission | Access |
|---|---|
| Administration | Read-only |
| Actions | Read-only |
| Checks | Read-only |
| Commit statuses | Read-only |
| Contents | Read and write |
| Issues | Read and write |
| Pull requests | Read and write |

Metadata read access is granted automatically.

Do not use a classic token with broad account-wide `repo` scope when a repository-scoped fine-grained token is available.

## Store the token

In `Wibias/shipping-github`:

1. Open **Settings** → **Secrets and variables** → **Actions**.
2. Choose **New repository secret**.
3. Name it exactly `LIVE_FIXTURE_TOKEN`.
4. Paste the fine-grained token as the value.

The secret is not available to pull-request workflows. The Live Integration workflow runs only through manual dispatch or its explicitly enabled schedule on the default branch.

## Preflight behavior

Before creating any fixture resource, the workflow runs:

```bash
node scripts/verify-live-fixture-token.mjs Wibias/shipping-github --base main
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

GitHub does not provide a reliable non-mutating probe for every write permission. The token must therefore be configured with the documented Contents, Issues, and Pull requests write permissions. Any denied write still fails the lifecycle and triggers namespaced cleanup.

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

Rotate the fine-grained token before expiration and immediately after suspected exposure. Replace the repository secret in place; no workflow change is required.
