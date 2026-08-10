using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal static class BranchScope
{
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
        var liveBranch = OptionalString(operation, "authorityBranch");
        if (!string.IsNullOrWhiteSpace(liveBranch)) return liveBranch.Trim();

        var action = OptionalString(operation, "action");
        return action switch
        {
            "push_code" => Normalize(OptionalString(operation, "branch")),
            "create_pr" => Normalize(OptionalString(operation, "head")),
            "delete_head_branch" => Normalize(OptionalString(operation, "headRefName")),
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
