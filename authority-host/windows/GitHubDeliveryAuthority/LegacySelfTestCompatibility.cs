namespace GitHubDeliveryAuthority;

internal sealed class WindowsFormsSynchronizationContext : SynchronizationContext
{
}

internal static class AuthorityHostContext
{
    internal static bool ShouldShowSetup(bool forceSetup, int allowedRepositoryCount)
        => AuthorityAppHost.ShouldShowSetup(forceSetup, allowedRepositoryCount);
}
