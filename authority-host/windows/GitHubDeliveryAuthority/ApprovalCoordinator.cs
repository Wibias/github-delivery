namespace GitHubDeliveryAuthority;

internal sealed class ApprovalCoordinator
{
    private readonly SynchronizationContext _uiContext;

    public ApprovalCoordinator(SynchronizationContext uiContext)
    {
        _uiContext = uiContext;
    }

    public Task<bool> ApproveBatchAsync(BatchApproval approval)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _uiContext.Post(_ =>
        {
            using var dialog = new ApprovalDialog(
                "GitHub Delivery Authorization",
                approval.Summaries,
                $"Approve {approval.Operations.Count} exact GitHub mutation(s) for {approval.Repo}");
            completion.TrySetResult(dialog.ShowDialog() == DialogResult.OK && dialog.Approved);
        }, null);
        return completion.Task;
    }

    public Task<bool> ApproveAdministrativeActionAsync(string action)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _uiContext.Post(_ =>
        {
            using var dialog = new ApprovalDialog(
                "GitHub Delivery Authority Administration",
                new[] { action },
                action);
            completion.TrySetResult(dialog.ShowDialog() == DialogResult.OK && dialog.Approved);
        }, null);
        return completion.Task;
    }
}
