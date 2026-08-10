using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal static class MutationClassifier
{
    private static readonly HashSet<string> DestructiveActions = new(StringComparer.Ordinal)
    {
        "push_code",
        "reply_human_thread",
        "resolve_thread",
        "resolve_bot_thread",
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

    private static readonly HashSet<string> SocialActions = new(StringComparer.Ordinal)
    {
        "post_review",
        "post_comment",
        "post_issue_comment",
        "edit_own_comment",
        "reply_bot_thread",
        "reply_human_thread",
        "create_follow_up_issue",
        "post_resolution_record",
    };

    public static bool RequiresWindowsHello(JsonElement operation)
    {
        var action = operation.GetProperty("action").GetString() ?? string.Empty;
        var mode = operation.TryGetProperty("mutationMode", out var modeValue) && modeValue.ValueKind == JsonValueKind.String
            ? modeValue.GetString() ?? "read-only"
            : "read-only";
        return string.Equals(mode, "maintainer", StringComparison.OrdinalIgnoreCase)
            || string.Equals(mode, "autonomous", StringComparison.OrdinalIgnoreCase)
            || DestructiveActions.Contains(action)
            || SocialActions.Contains(action);
    }

    public static bool RequiresExactHumanApproval(JsonElement operation)
        => string.Equals(operation.GetProperty("action").GetString(), "reply_human_thread", StringComparison.Ordinal);
}
