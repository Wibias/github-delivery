using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal static class MutationClassifier
{
    private static readonly HashSet<string> DestructiveActions = new(StringComparer.Ordinal)
    {
        "push_code",
        "reply_human_thread",
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
        return string.Equals(mode, "maintainer", StringComparison.OrdinalIgnoreCase)
            || DestructiveActions.Contains(action)
            || IsFullReviewVerdict(operation, action);
    }

    public static bool RequiresExactHumanApproval(JsonElement operation)
        => string.Equals(operation.GetProperty("action").GetString(), "reply_human_thread", StringComparison.Ordinal);

    private static bool IsFullReviewVerdict(JsonElement operation, string action)
    {
        if (!string.Equals(action, "post_comment", StringComparison.Ordinal)) return false;
        if (!operation.TryGetProperty("body", out var bodyValue) || bodyValue.ValueKind != JsonValueKind.String) return false;
        var body = bodyValue.GetString() ?? string.Empty;
        return body.Contains("github-delivery:full-review-verdict", StringComparison.OrdinalIgnoreCase)
            && body.Contains("## [GD] Verdict:", StringComparison.OrdinalIgnoreCase);
    }
}
