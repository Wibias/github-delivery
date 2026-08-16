using Microsoft.UI.Dispatching;

namespace GitHubDeliveryAuthority;

internal sealed class ApprovalCoordinator
{
    private readonly DispatcherQueue? _dispatcher;

    public ApprovalCoordinator(DispatcherQueue dispatcher)
    {
        _dispatcher = dispatcher;
    }

    internal ApprovalCoordinator(SynchronizationContext _)
    {
        _dispatcher = null;
    }

    public Task<ApprovalDecision> ApproveBatchAsync(BatchApproval approval)
    {
        var dispatcher = _dispatcher ?? throw new InvalidOperationException("authority_ui_dispatcher_unavailable");
        var completion = new TaskCompletionSource<ApprovalDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!dispatcher.TryEnqueue(async () =>
        {
            try
            {
                var window = new ApprovalWindow(
                    approval.Summaries,
                    $"Approve {approval.Operations.Count} exact GitHub mutation(s) for {approval.Repo}",
                    approval.Repo,
                    approval.Branch);
                var decision = await window.ShowAsync();
                if (decision.BranchLeaseMinutes is int minutes && (minutes < 1 || minutes > 10))
                {
                    throw new AuthorityException("branch_lease_minutes_invalid");
                }
                completion.TrySetResult(decision);
            }
            catch (Exception error) { completion.TrySetException(error); }
        })) completion.TrySetException(new InvalidOperationException("authority_ui_dispatch_failed"));
        return completion.Task;
    }

    public Task<bool> ApproveAdministrativeActionAsync(string action)
    {
        var dispatcher = _dispatcher ?? throw new InvalidOperationException("authority_ui_dispatcher_unavailable");
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!dispatcher.TryEnqueue(async () =>
        {
            try
            {
                var window = new ApprovalWindow(new[] { action }, action);
                completion.TrySetResult((await window.ShowAsync()).Approved);
            }
            catch (Exception error) { completion.TrySetException(error); }
        })) completion.TrySetException(new InvalidOperationException("authority_ui_dispatch_failed"));
        return completion.Task;
    }
}
