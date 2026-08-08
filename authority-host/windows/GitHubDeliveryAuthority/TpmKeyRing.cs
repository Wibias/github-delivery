using System.Security.Cryptography;
using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal sealed class TpmKeyRing
{
    private const string ProviderName = "Microsoft Platform Crypto Provider";
    private readonly StateStore _store;
    private readonly CngProvider _provider = new(ProviderName);

    public TpmKeyRing(StateStore store)
    {
        _store = store;
    }

    public SigningKeyRecord EnsureActiveKey(long now)
    {
        RetireExpiredKeys(now);
        var active = _store.GetActiveSigningKey();
        if (active is not null)
        {
            EnsureKeyExists(active);
            WriteTrustStore();
            return active;
        }

        var created = CreatePersistedKey(now);
        _store.InsertInitialSigningKey(created);
        WriteTrustStore();
        return created;
    }

    public SigningKeyRecord Rotate(long now, long overlapSeconds = 180)
    {
        if (overlapSeconds < 60 || overlapSeconds > 3600) throw new AuthorityException("key_rotation_overlap_invalid");
        var current = EnsureActiveKey(now);
        EnsureKeyExists(current);
        var next = CreatePersistedKey(now);
        _store.RotateSigningKey(next, checked(now + overlapSeconds));
        WriteTrustStore();
        return next;
    }

    public byte[] Sign(string kid, ReadOnlySpan<byte> data)
    {
        var keyRecord = _store.GetSigningKey(kid) ?? throw new AuthorityException("signing_key_not_found");
        if (keyRecord.Status is not ("active" or "retiring")) throw new AuthorityException("signing_key_not_usable");
        using var key = CngKey.Open(keyRecord.KeyName, _provider, CngKeyOpenOptions.UserKey);
        using var ecdsa = new ECDsaCng(key);
        return ecdsa.SignData(data, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    }

    public void RetireExpiredKeys(long now)
    {
        foreach (var key in _store.RetireExpiredKeys(now))
        {
            try
            {
                if (CngKey.Exists(key.KeyName, _provider, CngKeyOpenOptions.UserKey))
                {
                    using var cngKey = CngKey.Open(key.KeyName, _provider, CngKeyOpenOptions.UserKey);
                    cngKey.Delete();
                }
            }
            catch (CryptographicException)
            {
            }
        }
        WriteTrustStore();
    }

    public void WriteTrustStore()
    {
        var keys = _store.ListSigningKeys(includeRetired: true)
            .Select(key => new Dictionary<string, object?>
            {
                ["kid"] = key.Kid,
                ["alg"] = "ES256",
                ["publicKey"] = key.PublicKeyPem,
                ["status"] = key.Status,
                ["notAfter"] = key.RetireAfter,
                ["requireScopeHash"] = true,
                ["requireRedemption"] = true,
            })
            .ToArray();
        var document = new Dictionary<string, object?>
        {
            ["schemaVersion"] = 1,
            ["keys"] = keys,
        };
        var json = JsonSerializer.Serialize(document, new JsonSerializerOptions { WriteIndented = true });
        Directory.CreateDirectory(Path.GetDirectoryName(AppPaths.TrustStorePath) ?? AppPaths.RootDirectory);
        var temporary = AppPaths.TrustStorePath + ".tmp";
        File.WriteAllText(temporary, json + Environment.NewLine);
        File.Move(temporary, AppPaths.TrustStorePath, overwrite: true);
    }

    private SigningKeyRecord CreatePersistedKey(long now)
    {
        var keyName = $"github-delivery-authority-{Guid.NewGuid():N}";
        var parameters = new CngKeyCreationParameters
        {
            Provider = _provider,
            ExportPolicy = CngExportPolicies.None,
            KeyUsage = CngKeyUsages.Signing,
            KeyCreationOptions = CngKeyCreationOptions.None,
        };
        using var key = CngKey.Create(CngAlgorithm.ECDsaP256, keyName, parameters);
        using var ecdsa = new ECDsaCng(key);
        var spki = ecdsa.ExportSubjectPublicKeyInfo();
        var kid = $"win-tpm-{Convert.ToHexString(SHA256.HashData(spki)).ToLowerInvariant()[..16]}";
        var pem = PemEncoding.WriteString("PUBLIC KEY", spki);
        return new SigningKeyRecord(kid, keyName, pem, "active", now, null);
    }

    private void EnsureKeyExists(SigningKeyRecord key)
    {
        if (!CngKey.Exists(key.KeyName, _provider, CngKeyOpenOptions.UserKey))
        {
            throw new AuthorityException("tpm_signing_key_missing");
        }
    }
}
