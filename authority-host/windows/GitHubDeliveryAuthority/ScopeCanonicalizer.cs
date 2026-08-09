using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace GitHubDeliveryAuthority;

internal static partial class ScopeCanonicalizer
{
    private static readonly HashSet<string> MutationModes = new(StringComparer.Ordinal)
    {
        "read-only", "review", "maintainer", "autonomous",
    };

    [GeneratedRegex("\\n\\n<!-- github-delivery:idempotency [0-9a-f]{64} -->\\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex IdempotencyMarkerRegex();

    [GeneratedRegex("\\n\\n<!-- github-delivery:review-authority mode:(?:read-only|review|maintainer|autonomous) key:[A-Za-z0-9_-]+ grant:gd1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+ -->", RegexOptions.IgnoreCase)]
    private static partial Regex ReviewAuthorityMarkerRegex();

    public static JsonObject BuildScope(JsonElement request)
    {
        if (request.ValueKind != JsonValueKind.Object)
        {
            throw new AuthorityException("authority_scope_request_invalid");
        }

        var action = RequiredString(request, "action");
        var mode = (OptionalString(request, "mutationMode") ?? "read-only").ToLowerInvariant();
        if (!MutationModes.Contains(mode))
        {
            throw new AuthorityException("authority_scope_mutation_mode_invalid");
        }

        var scope = new JsonObject
        {
            ["action"] = action,
            ["mutationMode"] = mode,
            ["repo"] = RequiredString(request, "repo"),
        };

        switch (action)
        {
            case "merge_pr":
                AddPrScope(scope, request);
                scope["mergeMethod"] = NormalizeMergeMethod(OptionalString(request, "mergeMethod"));
                break;

            case "retarget_pr":
                AddPrScope(scope, request);
                scope["expectedBase"] = RequiredString(request, "expectedBase");
                scope["newBase"] = RequiredString(request, "newBase");
                break;

            case "push_code":
                scope["remote"] = RequiredString(request, "remote");
                scope["branch"] = RequiredString(request, "branch");
                scope["expectedRemoteTip"] = RequiredString(request, "expectedRemoteTip");
                scope["newTip"] = RequiredString(request, "newTip");
                scope["forceWithLease"] = request.TryGetProperty("forceWithLease", out var forceWithLease) && forceWithLease.ValueKind == JsonValueKind.True;
                break;

            case "create_pr":
                scope["base"] = RequiredString(request, "base");
                scope["head"] = RequiredString(request, "head");
                scope["draft"] = request.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.True;
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["titleSha256"] = Sha256(RequiredString(request, "title"));
                scope["bodySha256"] = BodySha256(request);
                break;

            case "update_pr_body":
                AddPrScope(scope, request);
                scope["bodySha256"] = BodySha256(request);
                break;

            case "create_issue":
            case "create_follow_up_issue":
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["titleSha256"] = Sha256(RequiredString(request, "title"));
                scope["bodySha256"] = BodySha256(request);
                break;

            case "assign_issue":
                scope["issue"] = PositiveInt(request, "issue");
                scope["assignee"] = RequiredString(request, "assignee");
                break;

            case "post_comment":
            case "post_resolution_record":
            case "post_review":
                AddPrScope(scope, request);
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["bodySha256"] = BodySha256(request);
                break;

            case "post_issue_comment":
                scope["issue"] = PositiveInt(request, "issue");
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["bodySha256"] = BodySha256(request);
                break;

            case "edit_own_comment":
                AddPrScope(scope, request);
                scope["commentId"] = PositiveInt(request, "commentId");
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["bodySha256"] = BodySha256(request);
                break;

            case "reply_bot_thread":
            case "reply_human_thread":
                AddPrScope(scope, request);
                scope["commentId"] = PositiveInt(request, "commentId");
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["bodySha256"] = BodySha256(request);
                break;

            case "resolve_thread":
            case "resolve_bot_thread":
                AddPrScope(scope, request);
                scope["threadId"] = RequiredString(request, "threadId");
                break;

            case "change_draft_state":
                AddPrScope(scope, request);
                scope["ready"] = !request.TryGetProperty("ready", out var ready) || ready.ValueKind != JsonValueKind.False;
                break;

            case "request_reviewers":
                AddPrScope(scope, request);
                scope["reviewers"] = CanonicalReviewers(request);
                break;

            case "close_pr":
                AddPrScope(scope, request);
                break;

            case "supersede_pr":
                AddPrScope(scope, request);
                var supersedingPr = OptionalPositiveInt(request, "supersedingPr");
                var body = OptionalString(request, "body");
                if (string.IsNullOrEmpty(body) && supersedingPr is not null)
                {
                    body = $"Superseded by PR #{supersedingPr.Value}.";
                }
                if (string.IsNullOrEmpty(body))
                {
                    throw new AuthorityException("authority_scope_body_or_superseding_pr_required");
                }
                if (supersedingPr is not null) scope["supersedingPr"] = supersedingPr.Value;
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["bodySha256"] = Sha256(VisibleBody(body));
                break;

            case "close_linked_issue":
                scope["issue"] = PositiveInt(request, "issue");
                break;

            case "delete_head_branch":
                scope["pr"] = PositiveInt(request, "pr");
                scope["targetRepo"] = RequiredString(request, "targetRepo", "authority_scope_target_repo_required");
                scope["headRefName"] = RequiredString(request, "headRefName");
                break;

            default:
                throw new AuthorityException($"authority_scope_unsupported_action:{action}");
        }

        return scope;
    }

    public static string ScopeSha256(JsonElement request)
        => Sha256(CanonicalJson.Serialize(BuildScope(request)));

    public static string BatchSha256(IReadOnlyList<JsonElement> operations)
    {
        if (operations.Count == 0) throw new AuthorityException("authority_batch_operations_required");
        var array = new JsonArray();
        foreach (var operation in operations) array.Add(BuildScope(operation));
        return Sha256(CanonicalJson.Serialize(array));
    }

    public static string VisibleBodySha256(JsonElement request) => BodySha256(request);

    public static JsonObject BuildResource(JsonElement request)
    {
        var resource = new JsonObject();
        foreach (var field in new[] { "pr", "issue", "commentId", "threadId", "expectedHead", "headRefName", "targetRepo", "supersedingPr", "remote", "branch", "expectedRemoteTip", "newTip", "base", "head", "assignee" })
        {
            if (!request.TryGetProperty(field, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                continue;
            }
            resource[field] = JsonNode.Parse(value.GetRawText());
        }
        return resource;
    }

    private static void AddPrScope(JsonObject scope, JsonElement request)
    {
        scope["pr"] = PositiveInt(request, "pr");
        scope["expectedHead"] = RequiredString(request, "expectedHead");
    }

    private static JsonArray CanonicalReviewers(JsonElement request)
    {
        if (!request.TryGetProperty("reviewers", out var reviewers) || reviewers.ValueKind != JsonValueKind.Array)
        {
            throw new AuthorityException("authority_scope_reviewers_invalid");
        }

        var values = reviewers.EnumerateArray()
            .Where(value => value.ValueKind == JsonValueKind.String)
            .Select(value => value.GetString()?.Trim() ?? string.Empty)
            .Where(value => value.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        if (values.Length == 0) throw new AuthorityException("authority_scope_reviewers_required");

        var array = new JsonArray();
        foreach (var reviewer in values) array.Add(reviewer);
        return array;
    }

    private static string NormalizeMergeMethod(string? value)
        => value is "squash" or "rebase" ? value : "merge";

    private static string BodySha256(JsonElement request)
        => Sha256(VisibleBody(RequiredString(request, "body")));

    private static string VisibleBody(string value)
    {
        var withoutIdempotency = IdempotencyMarkerRegex().Replace(value, string.Empty);
        return ReviewAuthorityMarkerRegex().Replace(withoutIdempotency, string.Empty);
    }

    internal static string Sha256(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static string RequiredString(JsonElement element, string name, string? code = null)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
        {
            throw new AuthorityException(code ?? $"authority_scope_{ToSnake(name)}_required");
        }
        var text = value.GetString();
        if (string.IsNullOrEmpty(text)) throw new AuthorityException(code ?? $"authority_scope_{ToSnake(name)}_required");
        return text;
    }

    private static string? OptionalString(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int PositiveInt(JsonElement element, string name)
    {
        var value = OptionalPositiveInt(element, name);
        if (value is null) throw new AuthorityException($"authority_scope_{ToSnake(name)}_invalid");
        return value.Value;
    }

    private static int? OptionalPositiveInt(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || !value.TryGetInt32(out var number) || number <= 0)
        {
            return null;
        }
        return number;
    }

    private static string ToSnake(string value)
        => Regex.Replace(value, "([a-z0-9])([A-Z])", "$1_$2").ToLowerInvariant();
}
