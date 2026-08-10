using System.Security.Cryptography;
using System.Text.Json;
using Windows.Security.Credentials.UI;

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
            BranchLeaseAndAuditFixture();
            ClassifierFixture();
            BusyGateFixture();
            HelloFailureFixture();
            HelloReadinessFixture();
            SetupRoutingFixture();
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

        using var branchA = JsonDocument.Parse("""
            {"schemaVersion":1,"action":"merge_pr","mutationMode":"maintainer","repo":"Wibias/github-delivery","pr":105,"expectedHead":"71ac000000000000000000000000000000000001","authorityBranch":"feature/a","mergeMethod":"merge"}
            """);
        using var branchB = JsonDocument.Parse("""
            {"schemaVersion":1,"action":"merge_pr","mutationMode":"maintainer","repo":"Wibias/github-delivery","pr":105,"expectedHead":"71ac000000000000000000000000000000000001","authorityBranch":"feature/b","mergeMethod":"merge"}
            """);
        Assert(
            ScopeCanonicalizer.ScopeSha256(branchA.RootElement) != ScopeCanonicalizer.ScopeSha256(branchB.RootElement),
            "branch must change the exact authority scope");
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

    private static void BranchLeaseAndAuditFixture()
    {
        var root = Path.Combine(Path.GetTempPath(), $"github-delivery-authority-lease-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            using var store = new StateStore(Path.Combine(root, "authority.db"));
            const string repo = "Wibias/github-delivery";
            const string branch = "feature/lease-test";
            var now = 1_786_150_000L;

            var lease = store.CreateBranchLease(repo, branch, now, 1);
            Assert(store.TryGetActiveBranchLease(repo, branch, now + 1)?.LeaseId == lease.LeaseId, "branch lease exact scope missing");
            Assert(store.TryGetActiveBranchLease(repo, "feature/other", now + 1) is null, "branch lease crossed branch scope");
            Assert(store.TryGetActiveBranchLease("Other/repo", branch, now + 1) is null, "branch lease crossed repository scope");
            Console.WriteLine("branch_lease_scope");

            var used = store.TryUseActiveBranchLease(repo, branch, now + 2, 2);
            Assert(used?.LeaseId == lease.LeaseId, "atomic branch lease use failed");
            Assert(store.ListRecentAuditEvents().Any(entry => entry.EventType == "branch_lease_used" && entry.Branch == branch), "branch lease use was not audited atomically");
            Console.WriteLine("branch_lease_atomic_use");

            Assert(store.TryGetActiveBranchLease(repo, branch, now + 61) is null, "expired branch lease remained active");
            Assert(store.RecordExpiredBranchLeases(now + 61) == 1, "expired branch lease was not audited");
            Assert(store.RecordExpiredBranchLeases(now + 62) == 0, "expired branch lease audit duplicated");
            Assert(
                store.ListRecentAuditEvents().Any(entry =>
                    entry.EventType == "branch_lease_expired" &&
                    entry.Repo == repo &&
                    entry.Branch == branch &&
                    entry.CreatedAt == lease.ExpiresAt),
                "branch lease expiry audit mismatch");
            Console.WriteLine("branch_lease_expiry");

            var revokeLease = store.CreateBranchLease(repo, "feature/revoke", now + 2, 5);
            Assert(store.RevokeBranchLease(revokeLease.LeaseId, now + 3), "branch lease revocation failed");
            Assert(store.TryGetActiveBranchLease(repo, "feature/revoke", now + 4) is null, "revoked branch lease remained active");
            Console.WriteLine("branch_lease_revocation");

            store.RecordAuditEvent("self_test_event", repo, branch, "ok", "metadata only", now + 5);
            var events = store.ListRecentAuditEvents();
            Assert(events.Any(entry => entry.EventType == "self_test_event" && entry.Repo == repo && entry.Branch == branch && entry.Outcome == "ok"), "audit event roundtrip failed");
            Console.WriteLine("audit_event_roundtrip");
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

    private static void BusyGateFixture()
    {
        var store = new StateStore(Path.Combine(Path.GetTempPath(), $"github-delivery-authority-busy-{Guid.NewGuid():N}", "authority.db"));
        try
        {
            var server = new AuthorityPipeServer(
                new AuthorityService(
                    store,
                    null!,
                    new ApprovalCoordinator(SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext())));
            var first = server.RunSerializedAuthorizeAsync(async () =>
            {
                await Task.Delay(50).ConfigureAwait(false);
                return "first-ok";
            });
            try
            {
                var second = server.RunSerializedAuthorizeAsync(async () => throw new Exception("must not run"));
                second.GetAwaiter().GetResult();
                throw new Exception("second concurrent authorize unexpectedly succeeded");
            }
            catch (AuthorityException error) when (error.Code == "authority_host_busy")
            {
            }
            var result = first.GetAwaiter().GetResult();
            Assert((string)result == "first-ok", "serialized authorize result mismatch");
        }
        finally
        {
            store.Dispose();
        }
    }

    private static void HelloFailureFixture()
    {
        Assert(HelloVerifier.DescribeFailure(UserConsentVerificationResult.Verified) is null, "verified Hello result must not have a failure message");
        Assert(
            HelloVerifier.DescribeFailure(UserConsentVerificationResult.NotConfiguredForUser)?.Contains("not configured", StringComparison.OrdinalIgnoreCase) == true,
            "unconfigured Hello result must explain the configuration problem");
        Assert(
            HelloVerifier.DescribeFailure(UserConsentVerificationResult.DeviceNotPresent)?.Contains("PIN", StringComparison.OrdinalIgnoreCase) == true,
            "missing-verifier failure must explain that a Windows Hello PIN is sufficient");
        Assert(
            HelloVerifier.DescribeFailure(UserConsentVerificationResult.Canceled)?.Contains("cancel", StringComparison.OrdinalIgnoreCase) == true,
            "canceled Hello result must explain the cancellation");
    }

    private static void HelloReadinessFixture()
    {
        var configured = HelloVerifier.DescribeAvailability(UserConsentVerifierAvailability.NotConfiguredForUser);
        Assert(!configured.Available, "unconfigured Hello must not be ready");
        Assert(configured.CanOpenSignInOptions, "unconfigured Hello must offer sign-in settings");
        Assert(configured.Message.Contains("PIN", StringComparison.OrdinalIgnoreCase), "setup guidance must say a PIN is sufficient");

        var absent = HelloVerifier.DescribeAvailability(UserConsentVerifierAvailability.DeviceNotPresent);
        Assert(!absent.Available, "missing verifier must not be ready");
        Assert(absent.CanOpenSignInOptions, "missing verifier must offer sign-in settings");
        Assert(absent.Message.Contains("PIN", StringComparison.OrdinalIgnoreCase), "missing-verifier guidance must mention PIN");

        var available = HelloVerifier.DescribeAvailability(UserConsentVerifierAvailability.Available);
        Assert(available.Available, "available Hello must be ready");
    }

    private static void SetupRoutingFixture()
    {
        Assert(AuthorityHostContext.ShouldShowSetup(false, 0), "empty allowlist must trigger first-run setup");
        Assert(AuthorityHostContext.ShouldShowSetup(true, 1), "--setup must force setup");
        Assert(!AuthorityHostContext.ShouldShowSetup(false, 1), "configured host must not force setup");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }
}
