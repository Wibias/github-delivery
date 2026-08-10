using System.Security.Cryptography;
using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal static class SelfTest
{
    private const string ExpectedMergeScope = "5792e06b57c2f0eece1cdc227d4ccb0b75012bb9ed65bbf183e3bd994aaeb8b8";

    public static int Run()
    {
        try
        {
            ScopeFixture();
            GrantFixture();
            LedgerFixture();
            ClassifierFixture();
            Console.WriteLine("windows-authority-self-test: PASS");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"windows-authority-self-test: FAIL: {error.Message}");
            return 1;
        }
    }

    private static void ScopeFixture()
    {
        using var document = JsonDocument.Parse("""
            {"schemaVersion":1,"action":"merge_pr","mutationMode":"maintainer","explicitInstruction":true,"repo":"Wibias/github-delivery","pr":105,"expectedHead":"71ac000000000000000000000000000000000001","mergeMethod":"merge"}
            """);
        var actual = ScopeCanonicalizer.ScopeSha256(document.RootElement);
        Assert(actual == ExpectedMergeScope, $"scope fixture mismatch: {actual}");
    }

    private static void GrantFixture()
    {
        using var signer = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var publicPem = signer.ExportSubjectPublicKeyInfoPem();
        var now = 1_786_150_000L;
        using var payload = JsonDocument.Parse($$"""
            {"version":1,"alg":"ES256","kid":"self-test","aud":"github-delivery","repo":"Wibias/github-delivery","action":"merge_pr","resource":{"pr":105,"expectedHead":"71ac000000000000000000000000000000000001"},"scopeSha256":"{{ExpectedMergeScope}}","batchId":"bch_test","batchIndex":0,"batchSha256":"{{new string('a', 64)}}","maxMutationMode":"maintainer","explicitInstruction":true,"issuedAt":{{now}},"expiresAt":{{now + 60}},"nonce":"gnt_test","redemption":"required","approvalMethod":"windows_hello"}
            """);
        var token = GrantCodec.CreateToken(payload.RootElement, signer);
        var record = new SigningKeyRecord("self-test", "ephemeral", publicPem, "active", now, null);
        var verified = GrantCodec.VerifyEs256(token, record, now + 1);
        Assert(verified.ScopeSha256 == ExpectedMergeScope, "grant verification scope mismatch");
    }

    private static void LedgerFixture()
    {
        var root = Path.Combine(Path.GetTempPath(), $"github-delivery-authority-self-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            using var store = new StateStore(Path.Combine(root, "authority.db"));
            var now = 1_786_150_000L;
            store.SetRepositoryAllowed("Wibias/github-delivery", true, now);
            Assert(store.IsRepositoryAllowed("Wibias/github-delivery"), "allowlist failed");
            store.InsertInitialSigningKey(new SigningKeyRecord("kid", "name", "pem", "active", now, null));
            store.RecordApprovalAndGrants(
                "apr_test", "bch_test", new string('a', 64), "Wibias/github-delivery", "windows_hello", now, now + 60,
                new[] { new GrantLedgerRecord("nonce", "bch_test", 0, "kid", "Wibias/github-delivery", "merge_pr", ExpectedMergeScope, now, now + 60) });
            var consumed = store.ConsumeGrant("nonce", "Wibias/github-delivery", ExpectedMergeScope, now + 1);
            Assert(consumed == now + 1, "consume time mismatch");
            try
            {
                store.ConsumeGrant("nonce", "Wibias/github-delivery", ExpectedMergeScope, now + 2);
                throw new Exception("second consumption unexpectedly succeeded");
            }
            catch (AuthorityException error) when (error.Code == "grant_already_consumed") { }
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    private static void ClassifierFixture()
    {
        using var merge = JsonDocument.Parse("{\"action\":\"merge_pr\",\"mutationMode\":\"maintainer\"}");
        using var autonomousRetarget = JsonDocument.Parse("{\"action\":\"retarget_pr\",\"mutationMode\":\"autonomous\"}");
        using var autonomousIssue = JsonDocument.Parse("{\"action\":\"create_issue\",\"mutationMode\":\"autonomous\"}");
        using var autonomousPr = JsonDocument.Parse("{\"action\":\"create_pr\",\"mutationMode\":\"autonomous\"}");
        using var botThread = JsonDocument.Parse("{\"action\":\"resolve_bot_thread\",\"mutationMode\":\"review\"}");
        using var comment = JsonDocument.Parse("{\"action\":\"post_comment\",\"mutationMode\":\"review\",\"body\":\"ordinary note\"}");
        using var review = JsonDocument.Parse("{\"action\":\"post_review\",\"mutationMode\":\"review\",\"body\":\"review note\"}");
        using var botReply = JsonDocument.Parse("{\"action\":\"reply_bot_thread\",\"mutationMode\":\"review\",\"body\":\"addressed\"}");
        using var humanReply = JsonDocument.Parse("{\"action\":\"reply_human_thread\",\"mutationMode\":\"review\"}");
        Assert(MutationClassifier.RequiresWindowsHello(merge.RootElement), "merge must require Hello");
        Assert(MutationClassifier.RequiresWindowsHello(autonomousRetarget.RootElement), "autonomous retarget must require Hello");
        Assert(MutationClassifier.RequiresWindowsHello(autonomousIssue.RootElement), "autonomous issue creation must require Hello");
        Assert(MutationClassifier.RequiresWindowsHello(autonomousPr.RootElement), "autonomous PR creation must require Hello");
        Assert(MutationClassifier.RequiresWindowsHello(botThread.RootElement), "bot thread resolution must require Hello even in review mode");
        Assert(MutationClassifier.RequiresWindowsHello(comment.RootElement), "ordinary review comment must require independent Hello approval");
        Assert(MutationClassifier.RequiresWindowsHello(review.RootElement), "review publication must require independent Hello approval");
        Assert(MutationClassifier.RequiresWindowsHello(botReply.RootElement), "bot reply must require independent Hello approval");
        Assert(MutationClassifier.RequiresWindowsHello(humanReply.RootElement), "human reply must require Hello");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }
}
