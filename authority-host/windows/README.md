# Windows authority host

This optional Windows 11 host turns a real local user approval into short-lived `gd1` authority grants for `github-delivery`.

## Security boundary

- The ECDSA P-256 signing key is persisted by the Microsoft Platform Crypto Provider (TPM-backed when available) and marked non-exportable.
- Whether a GitHub write requires this host is controlled by the global `github-delivery` protection mode: `off`, `high-assurance`, or `all`.
- In `high-assurance`, intrinsically high-assurance and autonomous execution requests require trusted authority. In `all`, every executed GitHub mutation does. In `off`, Windows Hello is not an additional mutation requirement; the ordinary github-delivery mutation policy still applies.
- One Hello approval can cover a finite, fully rendered batch; each mutation still receives its own exact-scope, short-lived grant.
- Human-thread reply grants bind the exact outgoing text. The ordinary exact-text confirmation policy is not waived by Windows Hello or by a temporary branch lease.
- Full-review verdict grants bind the exact human-visible verdict when the selected protection mode requires trusted authority.
- The host exposes only `status`, `authorizeBatch`, and `redeemGrant` over a current-user Named Pipe.
- Repository access is default-deny. Allowlist changes remain local authority state changes and require Windows Hello.
- Mutation grants expire after 60 seconds and must be redeemed exactly once before the GitHub write when redemption is required.
- The agent never receives private key material and the host has no arbitrary `sign(bytes)` endpoint.
- Only one approval prompt runs at a time. A concurrent `authorizeBatch` gets `authority_host_busy`; the Node client retries with bounded backoff while the visible prompt is pending.

Installing the host does **not** switch the global protection mode to a stricter setting automatically.

## Temporary branch grants

When an approval batch can be bound to one exact repository and branch, the approval window offers **Only this branch** for **1 to 10 minutes**.

A temporary branch grant has deliberately narrow semantics:

1. it can only be created after the current Windows Hello prompt succeeds;
2. it is stored for the exact `OWNER/REPO` plus exact branch name;
3. PR operations obtain the live `headRefName` immediately before approval, and that branch is included in the signed authority scope hash;
4. while the lease is active, another protected batch for the same repository and branch can skip the repeated Hello prompt;
5. every actual GitHub mutation still receives a new 60-second exact-effect grant and must pass normal redemption, head-freshness, mutation-mode, direct-instruction, idempotency, and exact-text rules;
6. the lease expires automatically and can be revoked immediately from the Control Center.

A branch lease is therefore a temporary reduction in repeated **OS prompts**, not a broad permission to mutate a repository.

## Local audit ledger

The Control Center reads a local SQLite audit ledger for authority activity and active branch leases. It records security-relevant metadata such as allowlist changes, Hello approval/denial, branch-lease creation/use/revocation, authorization issuance, and grant redemption.

The audit ledger does **not** store authority grant tokens, private key material, GitHub credentials, or exact GitHub message bodies. Temporary branch grants are stored separately as local repo/branch/time metadata.

## Requirements

- Windows 11 build 22000 or newer.
- Windows Hello for any protection mode or administrative action that needs OS-backed approval. A **Windows Hello PIN is sufficient**; fingerprint or face hardware is not required.
- TPM recommended for the Microsoft Platform Crypto Provider.
- Node.js/GitHub prerequisites from the normal github-delivery installation.
- **No .NET SDK is required for the stable managed Authority install/update path.**
- .NET 8 SDK is required only when building/installing the Authority host from repository source with `install.ps1`.

Stable releases publish an unpackaged, self-contained `win-x64` WinUI 3 application. Users do not need a separate Windows App SDK runtime installation for the published host.

If Windows Hello is not ready, the setup UI can open **Settings > Accounts > Sign-in options** so you can configure or repair the PIN before continuing.

## Stable managed install and update

The normal user-facing path is the github-delivery bootstrap:

```powershell
npx github-delivery setup
npx github-delivery doctor
npx github-delivery update
npx github-delivery update --apply
```

Every stable GitHub Release carries a separate Authority-host archive and metadata file built from the exact tagged source commit. Before any Authority runtime files are replaced, github-delivery verifies the component version/source identity, GitHub asset digest when available, metadata SHA-256, exact release/tag source binding, the `release.yml` artifact attestation, and a strict bounded ZIP extraction.

The managed installer keeps persistent state at:

```text
%LOCALAPPDATA%\GitHubDeliveryAuthority
```

Release-owned runtime files live in a versioned application directory such as:

```text
%LOCALAPPDATA%\GitHubDeliveryAuthority\app\v0.5.1
```

The root `authority-host-install.json` identifies the active release. `authority.db` and `trust-store.json` stay outside the versioned runtime directory and are preserved across replacement, as is `%LOCALAPPDATA%\github-delivery\config.json`.

Managed lifecycle rules are deliberate:

- `off` + no Authority host ever installed: do not download or install the component;
- `high-assurance` / `all` + missing host: `setup` installs the verified stable component on supported Windows x64;
- an already-installed or legacy host can be repaired/upgraded even if the current mode is `off`;
- a versioned host already equal to stable is unchanged;
- a host ahead of the stable release is reported as `already_ahead` and is never automatically downgraded;
- a configured install record whose executable is missing is treated as a broken install and repaired rather than mistaken for an intentional absence.

`doctor` is read-only and reports the skill and Authority host separately, including support/install state, version/source commit, whether the current mode requires Authority, and relations such as `missing`, `legacy`, `update`, `already_current`, or `already_ahead`.

### Control Center Settings

Open **Control Center > Settings** to choose the same persistent protection preference used by the Node CLI:

- **Off** -> `off`
- **Sensitive actions** -> `high-assurance` (**Recommended**)
- **Every GitHub write** -> `all`

The page shows the stored/effective protection mode plus installed Authority version/source metadata. If an environment override changes the effective mode, the UI warns that **Apply** changes the stored preference but does not override the active environment policy.

## Repository / source installation

For repository development, use PowerShell from the repository root:

```powershell
.\authority-host\windows\install.ps1
```

This is **not** the normal stable binary-distribution path. The source installer fails early unless it finds:

1. Windows 11 build 22000 or newer;
2. the `dotnet` command;
3. at least one installed .NET 8 SDK.

It builds the self-contained host into a temporary publish directory, stamps local version/source metadata, and then delegates deployment to `install-release.ps1` so source and stable installs share one state-preserving process/shortcut replacement boundary.

`install-release.ps1` does not call `dotnet`. It stops only a running `GitHubDeliveryAuthority` process whose resolved executable path is inside the selected install root, deploys a versioned runtime, recreates the per-user Startup shortcut, relies on the built-in trust-store and pipe defaults, verifies the installed metadata, and starts the host. The `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE` and `GITHUB_DELIVERY_AUTHORITY_PIPE` variables remain available as explicit overrides.

### First-run setup

The guided setup is fail-closed:

1. **Windows Hello readiness** calls `UserConsentVerifier.CheckAvailabilityAsync()`.
2. **Verify Windows Hello** runs a real Windows Hello prompt. This confirms the verifier works but does not authorize a repository change.
3. Enter the first repository as `OWNER/REPO`.
4. **Add repository** requires a second, fresh Windows Hello verification for that exact allowlist mutation.
5. Only after verification succeeds is the repository stored in the allowlist.

An empty allowlist opens first-run setup automatically. You can also reopen setup/readiness from the tray or start the installed executable with `--setup`.

## Windows Hello recovery

The UI reports the actual Windows Hello readiness/failure state instead of making a button look inactive.

| State | Meaning and recovery |
| --- | --- |
| `DeviceNotPresent` | Windows cannot currently expose a verifier. A Windows Hello PIN is enough; open Windows sign-in options, confirm a PIN exists, then check again. |
| `NotConfiguredForUser` | Windows Hello is not configured for this user. Configure a PIN under **Settings > Accounts > Sign-in options**, then check again. |
| `DisabledByPolicy` | Windows Hello is disabled by policy. An administrator may need to enable it. The host does not add a fallback authentication path. |
| `DeviceBusy` | Another Windows Hello operation is active. Finish or close that prompt, then check again. |
| `RetriesExhausted` | Verification stopped after too many failed attempts. Complete Windows-required recovery and try again later. |
| `Canceled` | The Windows Hello prompt was canceled. No approval-dependent authority state is created. |

For `DeviceNotPresent` and `NotConfiguredForUser`, the UI can open `ms-settings:signinoptions`. Opening Settings does not change authority state by itself.

## Upgrade behavior

For stable users, `npx github-delivery update` reports the skill plan and Authority-host plan independently. `npx github-delivery update --apply` keeps an already-installed Authority host aligned with the verified stable release; this remains true when the skill itself is already current, so a stale/legacy host can be the only component changed by an update.

The release installer preserves `authority.db`, `trust-store.json`, persistent github-delivery config, and unrelated user state. It does not claim success until the active install record and executable match the intended release version/source commit.

For source development, rerunning `install.ps1` rebuilds locally and delegates to the same release installer boundary.

## Use from github-delivery

Authorize a precomputed batch:

```powershell
node scripts/github-authorize.mjs --request batch.json --out authorized.json
```

The output contains the same broker requests with one `authorityGrant` attached to each operation. Execute individual requests through `scripts/github-mutate.mjs` as usual. Grants that declare `redemption: required` are atomically consumed by the host immediately before the GitHub mutation.

The preferred user-facing configuration path is **Control Center > Settings** or the prompt-driven setup/configuration workflow documented by the repository. The legacy environment switch remains a compatibility override that forces the equivalent of `all`:

```powershell
$env:GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY = '1'
```

## Key rotation

Key rotation requires Windows Hello. The old public key remains in the trust store as `retiring` for a short overlap window so already-issued 60-second grants can finish, then the host marks it retired and removes the old private key on a later maintenance pass.

## CI self-test

The CI self-test intentionally does not invoke TPM or Windows Hello:

```powershell
dotnet run --project .\authority-host\windows\GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj -c Release -- --self-test
```

It checks the shared Node/C# canonical scope fixture, ES256 verification with an ephemeral software key, SQLite one-time redemption, exact repo/branch lease isolation, lease expiry/revocation, audit round-trip behavior, Windows Hello readiness/result mapping, setup routing, and mutation classification.
