using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal sealed record SigningKeyRecord(
    string Kid,
    string KeyName,
    string PublicKeyPem,
    string Status,
    long CreatedAt,
    long? RetireAfter);

internal sealed record GrantLedgerRecord(
    string Nonce,
    string BatchId,
    int BatchIndex,
    string Kid,
    string Repo,
    string Action,
    string ScopeSha256,
    long IssuedAt,
    long ExpiresAt);

internal sealed record IssuedGrant(
    int Operation,
    string Token,
    string ScopeSha256,
    string Nonce);

internal sealed record BatchApproval(
    string Repo,
    string BatchId,
    string BatchSha256,
    IReadOnlyList<JsonElement> Operations,
    IReadOnlyList<string> Summaries,
    long ExpiresAt);

internal sealed record VerifiedGrant(
    string Kid,
    string Repo,
    string Action,
    string ScopeSha256,
    string Nonce,
    string BatchId,
    int BatchIndex,
    long IssuedAt,
    long ExpiresAt);
