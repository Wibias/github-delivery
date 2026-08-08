using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal static class GrantCodec
{
    private const string Prefix = "gd1";

    public static string CreateToken(JsonElement payload, Func<byte[], byte[]> signer)
    {
        var payloadBytes = Encoding.UTF8.GetBytes(payload.GetRawText());
        var payloadSegment = Base64UrlEncode(payloadBytes);
        var signedBytes = Encoding.ASCII.GetBytes($"{Prefix}.{payloadSegment}");
        var signature = signer(signedBytes);
        return $"{Prefix}.{payloadSegment}.{Base64UrlEncode(signature)}";
    }

    public static string CreateToken(JsonElement payload, ECDsa signer)
        => CreateToken(payload, data => signer.SignData(data, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));

    public static VerifiedGrant VerifyEs256(string token, SigningKeyRecord key, long now)
    {
        var parts = token.Split('.');
        if (parts.Length != 3 || parts[0] != Prefix) throw new AuthorityException("token_format_invalid");
        byte[] payloadBytes;
        byte[] signature;
        try
        {
            payloadBytes = Base64UrlDecode(parts[1]);
            signature = Base64UrlDecode(parts[2]);
        }
        catch (FormatException)
        {
            throw new AuthorityException("token_encoding_invalid");
        }

        using var publicKey = ECDsa.Create();
        publicKey.ImportFromPem(key.PublicKeyPem);
        var signedBytes = Encoding.ASCII.GetBytes($"{Prefix}.{parts[1]}");
        if (!publicKey.VerifyData(signedBytes, signature, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence))
        {
            throw new AuthorityException("bad_signature");
        }

        using var document = JsonDocument.Parse(payloadBytes);
        var payload = document.RootElement;
        if (RequiredInt(payload, "version") != 1) throw new AuthorityException("version_invalid");
        if (RequiredString(payload, "alg") != "ES256") throw new AuthorityException("algorithm_invalid");
        if (RequiredString(payload, "kid") != key.Kid) throw new AuthorityException("key_id_mismatch");
        if (RequiredString(payload, "aud") != "github-delivery") throw new AuthorityException("audience_invalid");
        var issuedAt = RequiredLong(payload, "issuedAt");
        var expiresAt = RequiredLong(payload, "expiresAt");
        if (expiresAt <= issuedAt || expiresAt < now) throw new AuthorityException("grant_expired");
        if (RequiredString(payload, "redemption") != "required") throw new AuthorityException("redemption_required");

        return new VerifiedGrant(
            key.Kid,
            RequiredString(payload, "repo"),
            RequiredString(payload, "action"),
            RequiredString(payload, "scopeSha256"),
            RequiredString(payload, "nonce"),
            RequiredString(payload, "batchId"),
            RequiredInt(payload, "batchIndex"),
            issuedAt,
            expiresAt);
    }

    private static string Base64UrlEncode(ReadOnlySpan<byte> bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded += (padded.Length % 4) switch { 2 => "==", 3 => "=", 0 => "", _ => throw new FormatException() };
        return Convert.FromBase64String(padded);
    }

    private static string RequiredString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(value.GetString()))
        {
            throw new AuthorityException($"{name}_missing");
        }
        return value.GetString()!;
    }

    private static int RequiredInt(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || !value.TryGetInt32(out var result)) throw new AuthorityException($"{name}_invalid");
        return result;
    }

    private static long RequiredLong(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || !value.TryGetInt64(out var result)) throw new AuthorityException($"{name}_invalid");
        return result;
    }
}
