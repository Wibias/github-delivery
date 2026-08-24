using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal static class BranchScope
{
    private static readonly HashSet<string> PrBoundActions = new(StringComparer.Ordinal)
    {
        "post_review",
        "dismiss_review",
        "post_comment",
        "edit_own_comment",
        "reply_bot_thread",
        "reply_human_thread",
        "resolve_thread",
        "resolve_bot_thread",
        "change_draft_state",
        "request_reviewers",
        "close_pr",
        "merge_pr",
        "retarget_pr",
        "post_resolution_record",
        "update_pr_body",
    };

    public static string? Resolve(IReadOnlyList<JsonElement> operations)
    {
        string? branch = null;
        foreach (var operation in operations)
        {
            var candidate = ResolveOperation(operation);
            if (candidate is null) return null;
            if (branch is null)
            {
                branch = candidate;
                continue;
            }
            if (!string.Equals(branch, candidate, StringComparison.Ordinal)) return null;
        }
        return branch;
    }

    private static string? ResolveOperation(JsonElement operation)
    {
        var action = OptionalString(operation, "action");
        if (action is null) return null;

        if (PrBoundActions.Contains(action))
        {
            return Normalize(OptionalString(operation, "authorityBranch"));
        }

        return action switch
        {
            "push_code" => Normalize(OptionalString(operation, "branch")),
            "create_pr" => Normalize(OptionalString(operation, "head")),
            _ => null,
        };
    }

    private static string? OptionalString(JsonElement element, string name)
        => element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? Normalize(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }
}
