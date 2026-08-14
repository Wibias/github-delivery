using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace GitHubDeliveryAuthority;

public partial class App : Application
{
    private readonly bool _forceSetup;
    private readonly bool _xamlSelfTest;
    private AuthorityAppHost? _host;

    internal int ExitCode { get; private set; }

    public App() : this(forceSetup: false, xamlSelfTest: false)
    {
    }

    public App(bool forceSetup) : this(forceSetup, xamlSelfTest: false)
    {
    }

    internal App(bool forceSetup, bool xamlSelfTest)
    {
        _forceSetup = forceSetup;
        _xamlSelfTest = xamlSelfTest;
        UnhandledException += (_, args) => StartupDiagnostics.Write(args.Exception, "App.UnhandledException");
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (_xamlSelfTest)
        {
            ExitCode = ControlCenterXamlSelfTest.Run();
            Application.Current.Exit();
            return;
        }

        var dispatcher = DispatcherQueue.GetForCurrentThread();
        _host = new AuthorityAppHost(dispatcher, _forceSetup);
        _host.Start();
    }
}
