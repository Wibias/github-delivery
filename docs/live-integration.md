# Live Integration setup

The **Live Integration** workflow exercises the real GitHub lifecycle against a **dedicated fixture repository**. The source repository is never accepted as its own live-mutation target.

The fixture run creates namespaced temporary issues, branches, and pull requests; observes the required checks; captures ship-gate evidence; proves stale-head rejection; closes the fixture pull request; and performs independent cleanup.

## Safety boundary

Live Integration is fail-closed before the first fixture mutation. The workflow requires all of these to agree:

1. a dedicated `OWNER/REPO` fixture repository;
2. that repository's immutable numeric GitHub repository ID;
3. an observed fixture repository ID equal to the configured ID;
4. source and fixture repository names to differ;
5. source and fixture numeric repository IDs to differ; and
6. a sentinel on the fixture base branch that binds the exact source and fixture names **and** numeric IDs.

A mistyped repository name that happens to point at another writable repository is therefore not enough to authorize the fixture.

## 1. Prepare the dedicated fixture repository

Choose a repository used only for github-delivery acceptance/lifecycle testing. Its default fixture base is `main`.

The target must be able to produce the checks that the lifecycle verifies:

- `CI / Node 22 / ubuntu-latest`
- `CI / Node 22 / windows-latest`
- `CI / Node 22 / macos-latest`
- `CI / Node 24 / ubuntu-latest`
- `CI / Node 24 / windows-latest`
- `CI / Node 24 / macos-latest`
- Dependency Review
- CodeQL

The lifecycle branch is built from the checked-out github-delivery source tree, but GitHub evaluates pull-request workflows according to the target repository's configuration. Keep the dedicated target's acceptance workflow/rules configuration aligned with the source repository.

## 2. Add the immutable target sentinel

On the fixture repository's `main` branch, create:

```text
.github/github-delivery-live-fixture.json
```

with this shape:

```json
{
  "schemaVersion": 1,
  "kind": "github-delivery/live-fixture-target",
  "fixtureRepository": "OWNER/FIXTURE_REPO",
  "fixtureRepositoryId": 123456789,
  "sourceRepository": "Wibias/github-delivery",
  "sourceRepositoryId": 1317569489
}
```

Use the real immutable numeric ID of the fixture repository. The source repository ID for `Wibias/github-delivery` is `1317569489`.

The verifier reads both repository objects from GitHub and reads this sentinel from the target base branch before accepting the target.

## 3. Configure source-repository Actions values

In `Wibias/github-delivery`, configure these repository Actions values:

| Name | Type | Purpose |
|---|---|---|
| `LIVE_FIXTURE_REPOSITORY` | variable | Dedicated `OWNER/REPO` target |
| `LIVE_FIXTURE_REPOSITORY_ID` | variable | Immutable numeric ID of that target |
| `LIVE_FIXTURE_TOKEN` | secret | Credential used by identity/capability preflight, lifecycle writes, and cleanup |
| `LIVE_FIXTURE_ENABLED` | variable, optional | Set to `true` only when scheduled execution should run |

Manual `workflow_dispatch` does not require `LIVE_FIXTURE_ENABLED=true`; the variable controls the scheduled run.

## Credential requirements

The ordinary workflow token remains read-only. `LIVE_FIXTURE_TOKEN` is exposed only to the target preflight, lifecycle, and cleanup steps.

Use a short-lived credential with the narrowest practical access to the dedicated fixture repository. It must be able to perform the lifecycle writes and pass the read-only capability preflight. The verifier checks:

- authenticated user identity;
- repository access;
- Actions workflow-run access;
- commit check-run access;
- commit-status access;
- active repository rules; and
- GraphQL branch-protection rules.

The verifier never prints the credential. Missing or under-scoped capability evidence fails before issue, branch, or pull-request creation.

## Preflight command

The workflow runs the equivalent of:

```bash
node scripts/verify-live-fixture-token.mjs \
  "OWNER/FIXTURE_REPO" \
  --source-repo "Wibias/github-delivery" \
  --fixture-repo-id "123456789" \
  --base main
```

with `GH_TOKEN` set from `LIVE_FIXTURE_TOKEN`.

This first verifies immutable target identity and the sentinel, then performs the non-mutating capability probes.

## Run acceptance

1. Open **Actions** → **Live Integration** in `Wibias/github-delivery`.
2. Choose **Run workflow** from `main`.
3. The workflow validates fixture variables before checkout.
4. Identity and credential capability checks run before mutation.
5. The lifecycle creates namespaced temporary resources in the dedicated fixture repository.
6. If GitHub requires approval for the temporary PR workflows, approve them before the observation timeout.
7. The workflow closes the fixture PR and removes the temporary issue/branch resources during cleanup.
8. Download the `live-fixture-<run-id>-<attempt>` artifact.

The workflow intentionally uses `--disposition close`. Live acceptance does not merge fixture PRs because a merge would require a real trusted authority grant.

## Evidence artifact

The artifact contains:

- `live-fixture-credential.json`
- `live-fixture-receipt.json`
- `live-fixture-cleanup.json`

A successful lifecycle receipt has `passed: true`, records complete required-check evidence, includes the stale-head rejection proof, and is accompanied by cleanup evidence.

## Failure and cleanup behavior

Lifecycle resources are namespaced by the exact run marker and derived branch. Normal failures trigger best-effort cleanup inside the lifecycle, and a separate `if: always()` workflow step performs independent cleanup if the lifecycle process fails or is interrupted.

Cleanup repeats the same fixture identity verification before destructive cleanup operations. It will not use a stale/mistyped repository configuration as a reason to clean an unrelated repository.

## Scheduled execution

The workflow has a weekly schedule, but scheduled execution is opt-in:

```text
LIVE_FIXTURE_ENABLED=true
```

Leave that variable unset or false until the dedicated target, sentinel, credential, and expected checks are provisioned.

## Rotation and operational maintenance

Rotate the fixture credential according to its issuer's policy and immediately after suspected exposure. If the fixture repository is recreated, renamed, or replaced, update **both** the configured repository ID and the sentinel; an old ID intentionally causes the workflow to fail closed.
