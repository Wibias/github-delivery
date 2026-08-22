using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal sealed record PrSessionKey(string Branch, int Pr, string? ExpectedBase, string? ExpectedBaseOid);

internal static class PrSessionScope
{
    public static PrSessionKey? Resolve(IReadOnlyList<JsonElement> operations)
    {
        if (operations.Count == 0) return null;
        if (!operations.All(MutationClassifier.IsPrSessionEligible)) return null;
        var branch = BranchScope.Resolve(operations);
        if (branch is null) return null;
        int? pr = null;
        string? expectedBase = null;
        string? expectedBaseOid = null;
        var sawMerge = false;
        foreach (var operation in operations)
        {
            if (!operation.TryGetProperty("pr", out var value) || !value.TryGetInt32(out var number) || number <= 0)
            {
                return null;
            }
            if (pr is null) pr = number;
            else if (pr.Value != number) return null;

            var action = operation.TryGetProperty("action", out var actionValue) && actionValue.ValueKind == JsonValueKind.String
                ? actionValue.GetString()
                : null;
            if (!string.Equals(action, "merge_pr", StringComparison.Ordinal)) continue;
            sawMerge = true;
            if (!TryExactString(operation, "expectedBase", out var batchBase)
                || !TryExactString(operation, "expectedBaseOid", out var batchOid))
            {
                return null;
            }
            batchOid = batchOid.ToLowerInvariant();
            if (expectedBase is null)
            {
                expectedBase = batchBase;
                expectedBaseOid = batchOid;
            }
            else if (!string.Equals(expectedBase, batchBase, StringComparison.Ordinal)
                || !string.Equals(expectedBaseOid, batchOid, StringComparison.Ordinal))
            {
                return null;
            }
        }
        if (pr is null) return null;
        if (sawMerge && (expectedBase is null || expectedBaseOid is null)) return null;
        return new PrSessionKey(branch, pr.Value, expectedBase, expectedBaseOid);
    }

    private static bool TryExactString(JsonElement operation, string name, out string value)
    {
        value = "";
        if (!operation.TryGetProperty(name, out var field) || field.ValueKind != JsonValueKind.String)
        {
            return false;
        }
        var text = field.GetString()?.Trim() ?? "";
        if (text.Length == 0) return false;
        value = text;
        return true;
    }
}
