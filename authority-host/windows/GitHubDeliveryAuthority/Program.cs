using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace GitHubDeliveryAuthority;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.Ordinal)) return SelfTest.Run();

        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
        {
            var exception = eventArgs.ExceptionObject as Exception
                ?? new Exception($"Unhandled non-Exception object: {eventArgs.ExceptionObject}");
            StartupDiagnostics.Write(exception, "AppDomain.UnhandledException");
        };

        try
        {
            var forceSetup = args.Contains("--setup", StringComparer.Ordinal);
            using var mutex = new Mutex(initiallyOwned: true, "Local\\GitHubDeliveryAuthority-v1", out var createdNew);
            if (!createdNew) return 0;

            StartupDiagnostics.Clear();
            WinRT.ComWrappersSupport.InitializeComWrappers();
            Application.Start(callbackParams =>
            {
                _ = callbackParams;
                var dispatcher = DispatcherQueue.GetForCurrentThread();
                SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(dispatcher));
                _ = new App(forceSetup);
            });
            return 0;
        }
        catch (Exception exception)
        {
            StartupDiagnostics.Write(exception, "Program.Main");
            return 1;
        }
    }
}
