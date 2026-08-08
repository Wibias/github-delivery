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

            case "create_follow_up_issue":
                scope["idempotencyKey"] = RequiredString(request, "idempotencyKey");
                scope["titleSha256"] = Sha256(RequiredString(request, "title"));
                scope["bodySha256"] = BodySha256(request);
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
        foreach (var field in new[] { "pr", "issue", "commentId", "threadId", "expectedHead", "headRefName", "targetRepo", "supersedingPr" })
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
        return new JsonArray(values.Select(JsonValue.Create).ToArray());
    }

    private static string NormalizeMergeMethod(string? value)
        => value is "squash" or "rebase" ? value : "merge";

    private static string BodySha256(JsonElement request)
        => Sha256(VisibleBody(RequiredString(request, "body")));

    private static string VisibleBody(string value)
        => IdempotencyMarkerRegex().Replace(value, string.Empty);

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
