# Windows authority host

This optional Windows 11 host turns a real local user approval into short-lived `gd1` authority grants for `github-delivery`.

## Security boundary

- ECDSA P-256 signing key is persisted by the Microsoft Platform Crypto Provider (TPM-backed when available) and marked non-exportable.
- Maintainer/destructive batches require Windows Hello before issuance.
- One Hello approval can cover a finite, fully rendered batch; each mutation receives its own exact-scope grant.
- The host exposes only `status`, `authorizeBatch`, and `redeemGrant` over a current-user Named Pipe.
- Repository access is default-deny. Allowlist changes and key rotation are only available in local UI and require Windows Hello.
- Grants expire after 60 seconds and must be redeemed exactly once before the GitHub write.
- The agent never receives private key material and the host has no arbitrary `sign(bytes)` endpoint.

The host is an optional stronger authorization path. Installing it does **not** enable `GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY=1` automatically.

## Requirements

- Windows 11 build 22000 or newer.
- Windows Hello configured for the signed-in user.
- TPM recommended for the Microsoft Platform Crypto Provider.
- .NET 8 SDK to build/install from source; the installer publishes a framework-dependent `win-x64` app.

## Install

From PowerShell:

```powershell
.\authority-host\windows\install.ps1
```

The installer:

1. publishes the tray host under `%LOCALAPPDATA%\GitHubDeliveryAuthority`;
2. creates a per-user Startup shortcut;
3. sets `GITHUB_DELIVERY_AUTHORITY_TRUST_STORE` to the generated public-key trust store;
4. sets `GITHUB_DELIVERY_AUTHORITY_PIPE=github-delivery-authority-v1`;
5. starts the tray host;
6. leaves strict trusted-authority enforcement disabled.

Open the tray icon and add `Wibias/github-delivery` (or any other repository you intentionally trust). The host starts with an empty allowlist.

## Use from github-delivery

Authorize a precomputed batch:

```powershell
node scripts/github-authorize.mjs --request batch.json --out authorized.json
```

The output contains the same broker requests with one `authorityGrant` attached to each operation. Execute individual requests through `scripts/github-mutate.mjs` as usual. Grants that declare `redemption: required` are atomically consumed by the host immediately before the GitHub mutation.

To require trusted authority for broker requests in a deployment, opt in explicitly:

```powershell
$env:GITHUB_DELIVERY_REQUIRE_TRUSTED_AUTHORITY = '1'
```

## Key rotation

Use **Rotate signing key** in the tray menu. Windows Hello is required. The old public key remains in the trust store as `retiring` for a short overlap window so already-issued 60-second grants can finish, then the host marks it retired and removes the old TPM private key on its next maintenance pass.

## CI self-test

The CI self-test intentionally does not invoke TPM or Windows Hello:

```powershell
dotnet run --project .\authority-host\windows\GitHubDeliveryAuthority\GitHubDeliveryAuthority.csproj -c Release -- --self-test
```

It checks the shared Node/C# canonical scope fixture, ES256 token verification with an ephemeral software key, the SQLite one-time redemption invariant, and the maintainer/review classifier.
