using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace GitHubDeliveryAuthority;

internal sealed class AuthorityAppHost : IDisposable
{
    private readonly DispatcherQueue _dispatcher;
    private readonly bool _forceSetup;
    private StateStore? _store;
    private TpmKeyRing? _keys;
    private AuthorityPipeServer? _pipe;
    private ControlCenterWindow? _controlCenter;
    private TrayIcon? _tray;
    private bool _disposed;

    public AuthorityAppHost(DispatcherQueue dispatcher, bool forceSetup)
    {
        _dispatcher = dispatcher;
        _forceSetup = forceSetup;
    }

    public void Start()
    {
        Directory.CreateDirectory(AppPaths.RootDirectory);
        _store = new StateStore(AppPaths.DatabasePath);
        _keys = new TpmKeyRing(_store);
        _keys.EnsureActiveKey(DateTimeOffset.UtcNow.ToUnixTimeSeconds());

        var coordinator = new ApprovalCoordinator(_dispatcher);
        var service = new AuthorityService(_store, _keys, coordinator);
        _pipe = new AuthorityPipeServer(service, Environment.GetEnvironmentVariable("GITHUB_DELIVERY_AUTHORITY_PIPE") ?? AuthorityPipeServer.DefaultPipeName);
        _pipe.Start();

        _controlCenter = new ControlCenterWindow(_store);
        _tray = new TrayIcon(_dispatcher, ShowControlCenter, Exit);
        if (ShouldShowSetup(_forceSetup, _store.ListAllowedRepositories().Count)) ShowControlCenter();
    }

    internal static bool ShouldShowSetup(bool forceSetup, int allowedRepositoryCount)
        => forceSetup || allowedRepositoryCount == 0;

    private void ShowControlCenter() => _controlCenter?.ShowControlCenter();

    private void Exit()
    {
        _controlCenter?.PrepareForExit();
        Dispose();
        Application.Current.Exit();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _tray?.Dispose();
        if (_pipe is not null) _pipe.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _store?.Dispose();
    }
}
