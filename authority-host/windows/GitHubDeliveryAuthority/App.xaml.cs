using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace GitHubDeliveryAuthority;

public partial class App : Application
{
    private readonly bool _forceSetup;
    private AuthorityAppHost? _host;

    public App() : this(forceSetup: false)
    {
    }

    public App(bool forceSetup)
    {
        _forceSetup = forceSetup;
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var dispatcher = DispatcherQueue.GetForCurrentThread();
        _host = new AuthorityAppHost(dispatcher, _forceSetup);
        _host.Start();
    }
}
