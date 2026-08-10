# Windows authority host

This optional Windows 11 host turns a real local user approval into short-lived `gd1` authority grants for `github-delivery`.

## Security boundary

- ECDSA P-256 signing key is persisted by the Microsoft Platform Crypto Provider (TPM-backed when available) and marked non-exportable.
- Windows Hello is required for protected/high-assurance issuance: maintainer-mode operations, destructive actions such as code pushes/merges/human-thread replies, and format-recognized full-review verdict publication.
- One Hello approval can cover a finite, fully rendered batch; each mutation receives its own exact-scope grant.
- Human-thread reply grants bind the exact outgoing text; caller-supplied `exactTextConfirmed` is not sufficient by itself.
- Full-review verdict grants bind the exact human-visible verdict and support the durable provenance marker later re-verified as merge-review evidence.
- The host exposes only `status`, `authorizeBatch`, and `redeemGrant` over a current-user Named Pipe.
- Repository access is default-deny. Allowlist changes and key rotation are only available in local UI and require Windows Hello.
- Grants expire after 60 seconds and must be redeemed exactly once before the GitHub write when redemption is required.
- The agent never receives private key material and the host has no arbitrary `sign(bytes)` endpoint.
- The approval dialog is foreground-visible (`TopMost`, activates, flashes the
  taskbar) so a Windows Hello prompt is never silently hidden behind other
  windows.
- Only one approval prompt runs at a time. A concurrent `authorizeBatch` gets a
  distinct `authority_host_busy` error; the Node client retries it with backoff
  until the pending prompt finishes or a configurable deadline expires.

The host is an optional stronger authorization path. Installing it does **not** enable `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` automatically.

## Requirements

- Windows 11 build 22000 or newer.
- Windows Hello for the signed-in user. A **Windows Hello PIN is sufficient**; fingerprint or face hardware is not required.
- TPM recommended for the Microsoft Platform Crypto Provider.
- .NET 8 SDK to build/install from source; the installer publishes a framework-dependent `win-x64` app.

If Windows Hello is not ready, the setup UI can open **Settings > Accounts > Sign-in options** so you can configure or repair the PIN before continuing.

## Install

From PowerShell at the repository root:

```powershell
.\authority-host\windows\install.ps1
```

The installer fails early unless it finds:

1. Windows 11 build 22000 or newer;
2. the `dotnet` command;
3. at least one installed .NET 8 SDK.

It then:

1. publishes the tray host under `%LOCALAPPDATA%\GitHubDeliveryAuthority`;
2. stops only a running `GitHubDeliveryAuthority` process whose executable is inside that install directory, so upgrades can replace the binary cleanly;
3. copies the new files and creates a per-user Startup shortcut;
4. sets `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE` to the generated public-key trust store;
5. sets `GITHUB_DELIVERY_AUTHORITY_PIPE=github-delivery-authority-v1`;
6. starts the host with `--setup`;
7. leaves strict trusted-authority enforcement disabled.

### First-run setup

The guided setup is intentionally fail-closed:

1. **Windows Hello readiness** calls `UserConsentVerifier.CheckAvailabilityAsync()`.
2. **Verify Windows Hello** runs a real Windows Hello prompt. This confirms the verifier works but does not authorize a repository change.
3. Enter the first repository as `OWNER/REPO`.
4. **Add repository** requires a second, fresh Windows Hello verification for that exact allowlist mutation.
5. Only after that verification succeeds is the repository stored in the allowlist.

An empty allowlist opens first-run setup automatically. You can also reopen it from the tray with **Setup / readiness**, or start the installed executable with `--setup`.

The existing repository allowlist remains available from the tray after setup. Add and remove operations continue to require their own Windows Hello verification.

## Windows Hello recovery

The UI reports the actual Windows Hello readiness/failure state instead of making a button look inactive.

| State | Meaning and recovery |
| --- | --- |
| `DeviceNotPresent` | Windows cannot currently expose a verifier. A Windows Hello PIN is enough; use **Open Windows sign-in options**, confirm a PIN exists, then **Check again**. |
| `NotConfiguredForUser` | Windows Hello is not configured for this user. Open **Settings > Accounts > Sign-in options**, configure a PIN, then **Check again**. |
| `DisabledByPolicy` | Windows Hello is disabled by policy. An administrator may need to enable it. The host does not add a fallback authentication path. |
| `DeviceBusy` | Another Windows Hello operation is active. Finish or close that prompt, then **Check again**. |
| `RetriesExhausted` | Verification stopped after too many failed attempts. Complete any Windows-required recovery and try again later. |
| `Canceled` | The Windows Hello prompt was canceled. No authority state changes are made. |

For `DeviceNotPresent` and `NotConfiguredForUser`, the setup and allowlist UI can offer **Open Windows sign-in options**. It uses the Windows `ms-settings:signinoptions` page and does not change authority state by itself.

## Upgrade behavior

Running `install.ps1` again performs the same prerequisite checks, publishes the replacement build, stops only the currently installed authority-host instance under the selected install directory, replaces the files, and starts the new host with `--setup`.

Existing authority state remains in the configured install directory. The installer still does not enable `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` automatically.

## Use from github-delivery

Authorize a precomputed batch:

```powershell
node scripts/github-authorize.mjs --request batch.json --out authorized.json
```

The output contains the same broker requests with one `authorityGrant` attached to each operation. For a full-review verdict, the helper also stamps the durable hidden review-authority provenance required by the verdict verifier without changing the human-visible verdict hash.

Execute individual requests through `scripts/github-mutate.mjs` as usual. Grants that declare `redemption: required` are atomically consumed by the host immediately before the GitHub mutation.

To require trusted authority for every broker request in a deployment, opt in explicitly:

```powershell
$env:GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY = '1'
```

High-assurance actions can still require trusted authority even when that global switch is not enabled.

## Key rotation

Use **Rotate signing key** in the tray menu. Windows Hello is required. The old public key remains in the trust store as `retiring` for a short overlap window so already-issued 60-second grants can finish, then the host marks it retired and removes the old TPM private key on its next maintenance pass.

## CI self-test

The CI self-test intentionally does not invoke TPM or Windows Hello:

```powershell
dotnet run --project .\authority-host\windows\GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj -c Release -- --self-test
```

It checks the shared Node/C# canonical scope fixture, ES256 token verification with an ephemeral software key, the SQLite one-time redemption invariant, Windows Hello readiness/result mapping, setup routing, and mutation classification including the high-assurance review-verdict/human-reply cases.
