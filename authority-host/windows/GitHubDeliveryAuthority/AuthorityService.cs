using System.Text.Json;
using System.Text.Json.Nodes;

namespace GitHubDeliveryAuthority;

internal sealed class AuthorityService
{
    private const int MaxOperations = 20;
    private const long GrantTtlSeconds = 60;
    private readonly StateStore _store;
    private readonly TpmKeyRing _keys;
    private readonly ApprovalCoordinator _approvals;
    private readonly Func<bool> _showControlCenter;

    public AuthorityService(
        StateStore store,
        TpmKeyRing keys,
        ApprovalCoordinator approvals,
        Func<bool>? showControlCenter = null)
    {
        _store = store;
        _keys = keys;
        _approvals = approvals;
        _showControlCenter = showControlCenter ?? (() => false);
    }

    public object Status()
    {
        var active = _store.GetActiveSigningKey();
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return new
        {
            status = "ready",
            protocol = AuthorityPipeServer.Protocol,
            key = active is null ? null : new { kid = active.Kid, alg = "ES256", active.Status },
            allowedRepositories = _store.ListAllowedRepositories(),
            activeBranchLeases = _store.ListActiveBranchLeases(now).Count,
            activePrSessions = _store.ListActivePrSessions(now).Count,
        };
    }

    public object ShowControlCenter()
    {
        if (!_showControlCenter()) throw new AuthorityException("authority_control_center_show_failed");
        return new { status = "shown" };
    }

    public async Task<object> AuthorizeBatchAsync(JsonElement parameters)
    {
        if (!parameters.TryGetProperty("operations", out var operationArray) || operationArray.ValueKind != JsonValueKind.Array)
        {
            throw new AuthorityException("authority_batch_operations_required");
        }
        var operations = operationArray.EnumerateArray().Select(item => item.Clone()).ToArray();
        if (operations.Length is < 1 or > MaxOperations) throw new AuthorityException("authority_batch_operation_count_invalid");

        var repos = operations.Select(operation => RequiredString(operation, "repo")).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (repos.Length != 1) throw new AuthorityException("authority_batch_single_repo_required");
        var repo = repos[0];
        if (!_store.IsRepositoryAllowed(repo)) throw new AuthorityException("repo_not_allowed");

        var scopes = operations.Select(ScopeCanonicalizer.ScopeSha256).ToArray();
        var batchHash = ScopeCanonicalizer.BatchSha256(operations);
        var batchId = $"bch_{Guid.NewGuid():N}";
        var approvalId = $"apr_{Guid.NewGuid():N}";
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var expiresAt = checked(now + GrantTtlSeconds);
        var summaries = operations.Select((operation, index) => BuildSummary(index, operation, scopes[index])).ToArray();
        var branch = BranchScope.Resolve(operations);
        var session = PrSessionScope.Resolve(operations);
        var sessionEligible = session is not null;
        var branchLeaseEligible = !sessionEligible && branch is not null && operations.All(MutationClassifier.IsBranchLeaseEligible);
        var requiresHello = operations.Any(MutationClassifier.RequiresWindowsHello);
        var hasStandaloneExactHumanReply = operations.Any(MutationClassifier.RequiresExactHumanApproval) && !requiresHello;
        if (hasStandaloneExactHumanReply)
        {
            throw new AuthorityException("exact_text_trusted_authority_requires_hello_batch");
        }

        var approvalMethod = "host_policy";
        if (requiresHello)
        {
            var activeSession = sessionEligible
                ? _store.TryUseActivePrSession(repo, session!.Branch, session.Pr, now, operations.Length)
                : null;
            if (activeSession is not null)
            {
                approvalMethod = "pr_session";
                branch = session!.Branch;
            }
            else
            {
                var activeLease = branchLeaseEligible
                    ? _store.TryUseActiveBranchLease(repo, branch!, now, operations.Length)
                    : null;
                if (activeLease is not null)
                {
                    approvalMethod = "branch_lease";
                }
                else
                {
                    var approval = new BatchApproval(
                        repo,
                        batchId,
                        batchHash,
                        operations,
                        summaries,
                        expiresAt,
                        sessionEligible ? session!.Branch : branchLeaseEligible ? branch : null,
                        sessionEligible ? session!.Pr : null);
                    var decision = await _approvals.ApproveBatchAsync(approval).ConfigureAwait(false);
                    if (!decision.Approved)
                    {
                        _store.RecordAuditEvent("approval_denied", repo, branch, "denied", $"operations={operations.Length}", now);
                        throw new AuthorityException("user_denied");
                    }
                    approvalMethod = "windows_hello";
                    now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                    expiresAt = checked(now + GrantTtlSeconds);
                    _store.RecordAuditEvent("approval_granted", repo, branch, "approved", $"operations={operations.Length}", now);
                    if (decision.PrSessionMinutes is int sessionMinutes)
                    {
                        if (!sessionEligible || session is null)
                        {
                            throw new AuthorityException("pr_session_action_not_eligible");
                        }
                        _store.CreatePrSession(repo, session.Branch, session.Pr, now, sessionMinutes);
                    }
                    else if (decision.BranchLeaseMinutes is int branchLeaseMinutes)
                    {
                        if (!branchLeaseEligible || branch is null)
                        {
                            throw new AuthorityException("branch_lease_action_not_eligible");
                        }
                        _store.CreateBranchLease(repo, branch, now, branchLeaseMinutes);
                    }
                }
            }
        }

        var activeKey = _keys.EnsureActiveKey(now);
        var issued = new List<IssuedGrant>();
        var ledger = new List<GrantLedgerRecord>();
        for (var index = 0; index < operations.Length; index++)
        {
            var operation = operations[index];
            var action = RequiredString(operation, "action");
            var nonce = $"gnt_{Guid.NewGuid():N}";
            var resource = ScopeCanonicalizer.BuildResource(operation);
            var requestedMode = OptionalString(operation, "mutationMode") ?? "read-only";
            var payload = new JsonObject
            {
                ["version"] = 1,
                ["alg"] = "ES256",
                ["kid"] = activeKey.Kid,
                ["aud"] = "github-delivery",
                ["repo"] = repo,
                ["action"] = action,
                ["resource"] = resource,
                ["scopeSha256"] = scopes[index],
                ["batchId"] = batchId,
                ["batchIndex"] = index,
                ["batchSha256"] = batchHash,
                ["maxMutationMode"] = requestedMode.ToLowerInvariant(),
                ["explicitInstruction"] = requiresHello,
                ["issuedAt"] = now,
                ["expiresAt"] = expiresAt,
                ["nonce"] = nonce,
                ["redemption"] = "required",
                ["approvalMethod"] = approvalMethod,
            };
            if (requiresHello && string.Equals(action, "reply_human_thread", StringComparison.Ordinal))
            {
                payload["exactTextSha256"] = ScopeCanonicalizer.VisibleBodySha256(operation);
            }
            using var payloadDocument = JsonDocument.Parse(payload.ToJsonString());
            var token = GrantCodec.CreateToken(payloadDocument.RootElement, bytes => _keys.Sign(activeKey.Kid, bytes));
            issued.Add(new IssuedGrant(index, token, scopes[index], nonce));
            ledger.Add(new GrantLedgerRecord(nonce, batchId, index, activeKey.Kid, repo, action, scopes[index], now, expiresAt));
        }

        _store.RecordApprovalAndGrants(approvalId, batchId, batchHash, repo, approvalMethod, now, expiresAt, ledger);
        _store.RecordAuditEvent(
            "authorization_issued",
            repo,
            branch,
            "issued",
            $"approval_method={approvalMethod};operations={operations.Length}",
            now);
        return new
        {
            batchId,
            expiresAt,
            approvalMethod,
            grants = issued.Select(grant => new { operation = grant.Operation, token = grant.Token }).ToArray(),
        };
    }

    public object RedeemGrant(JsonElement parameters)
    {
        var token = RequiredString(parameters, "grant");
        var requestedScope = RequiredString(parameters, "scopeSha256");
        var payload = ParsePayload(token);
        var kid = RequiredString(payload, "kid");
        var key = _store.GetSigningKey(kid) ?? throw new AuthorityException("key_not_found");
        if (key.Status == "retired") throw new AuthorityException("key_retired");
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var grant = GrantCodec.VerifyEs256(token, key, now);
        if (!string.Equals(grant.ScopeSha256, requestedScope, StringComparison.Ordinal)) throw new AuthorityException("scope_mismatch");
        if (!_store.IsRepositoryAllowed(grant.Repo)) throw new AuthorityException("repo_not_allowed");
        var consumedAt = _store.ConsumeGrant(grant.Nonce, grant.Repo, requestedScope, now);
        _store.RecordAuditEvent("grant_redeemed", grant.Repo, null, "consumed", $"action={grant.Action}", consumedAt);
        return new { status = "consumed", nonce = grant.Nonce, consumedAt };
    }

    private static JsonElement ParsePayload(string token)
    {
        var parts = token.Split('.');
        if (parts.Length != 3 || parts[0] != "gd1") throw new AuthorityException("token_format_invalid");
        var value = parts[1].Replace('-', '+').Replace('_', '/');
        value += (value.Length % 4) switch { 2 => "==", 3 => "=", 0 => "", _ => throw new AuthorityException("token_encoding_invalid") };
        try
        {
            using var document = JsonDocument.Parse(Convert.FromBase64String(value));
            return document.RootElement.Clone();
        }
        catch
        {
            throw new AuthorityException("payload_invalid");
        }
    }

    private static string BuildSummary(int index, JsonElement operation, string scope)
    {
        var action = RequiredString(operation, "action");
        var repo = RequiredString(operation, "repo");
        var target = operation.TryGetProperty("pr", out var pr) ? $"PR #{pr.GetInt32()}"
            : operation.TryGetProperty("issue", out var issue) ? $"issue #{issue.GetInt32()}"
            : repo;
        var lines = new List<string> { $"{index + 1}. {action} — {target}", $"   repo: {repo}" };
        if (string.Equals(action, "push_code", StringComparison.Ordinal) &&
            operation.TryGetProperty("branch", out var pushBranch) && pushBranch.ValueKind == JsonValueKind.String)
        {
            lines.Add($"   branch: {pushBranch.GetString()}");
        }
        else if (string.Equals(action, "create_pr", StringComparison.Ordinal))
        {
            if (operation.TryGetProperty("base", out var baseRef) && baseRef.ValueKind == JsonValueKind.String) lines.Add($"   base: {baseRef.GetString()}");
            if (operation.TryGetProperty("head", out var headRef) && headRef.ValueKind == JsonValueKind.String) lines.Add($"   head: {headRef.GetString()}");
        }
        else if (operation.TryGetProperty("authorityBranch", out var authorityBranch) && authorityBranch.ValueKind == JsonValueKind.String)
        {
            lines.Add($"   branch: {authorityBranch.GetString()}");
        }
        if (operation.TryGetProperty("expectedHead", out var head) && head.ValueKind == JsonValueKind.String) lines.Add($"   head: {head.GetString()}");
        if (operation.TryGetProperty("mergeMethod", out var method) && method.ValueKind == JsonValueKind.String) lines.Add($"   merge method: {method.GetString()}");
        if (operation.TryGetProperty("body", out var body) && body.ValueKind == JsonValueKind.String)
        {
            var text = body.GetString() ?? string.Empty;
            lines.Add("   exact text:");
            lines.Add(string.Join(Environment.NewLine, text.Split('\n').Select(line => $"     {line}")));
        }
        lines.Add($"   scope: {scope}");
        return string.Join(Environment.NewLine, lines);
    }

    private static string RequiredString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new AuthorityException($"{name}_required");
        }
        return value.GetString()!;
    }

    private static string? OptionalString(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
