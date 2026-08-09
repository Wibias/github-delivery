using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal static class MutationClassifier
{
    private static readonly HashSet<string> DestructiveActions = new(StringComparer.Ordinal)
    {
        "push_code",
        "resolve_thread",
        "change_draft_state",
        "request_reviewers",
        "close_linked_issue",
        "close_pr",
        "supersede_pr",
        "merge_pr",
        "retarget_pr",
        "delete_head_branch",
        "create_follow_up_issue",
    };

    public static bool RequiresWindowsHello(JsonElement operation)
    {
        var action = operation.GetProperty("action").GetString() ?? string.Empty;
        var mode = operation.TryGetProperty("mutationMode", out var modeValue) && modeValue.ValueKind == JsonValueKind.String
            ? modeValue.GetString() ?? "read-only"
            : "read-only";
        return string.Equals(mode, "maintainer", StringComparison.OrdinalIgnoreCase) || DestructiveActions.Contains(action);
    }

    public static bool RequiresExactHumanApproval(JsonElement operation)
        => string.Equals(operation.GetProperty("action").GetString(), "reply_human_thread", StringComparison.Ordinal);
}
