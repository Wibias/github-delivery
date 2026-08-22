using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal sealed record PrSessionKey(string Branch, int Pr);

internal static class PrSessionScope
{
    public static PrSessionKey? Resolve(IReadOnlyList<JsonElement> operations)
    {
        if (operations.Count == 0) return null;
        if (!operations.All(MutationClassifier.IsPrSessionEligible)) return null;
        var branch = BranchScope.Resolve(operations);
        if (branch is null) return null;
        int? pr = null;
        foreach (var operation in operations)
        {
            if (!operation.TryGetProperty("pr", out var value) || !value.TryGetInt32(out var number) || number <= 0)
            {
                return null;
            }
            if (pr is null) pr = number;
            else if (pr.Value != number) return null;
        }
        return pr is null ? null : new PrSessionKey(branch, pr.Value);
    }
}
