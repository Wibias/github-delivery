using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace GitHubDeliveryAuthority;

internal static class Program
{
    [DllImport("Microsoft.ui.xaml.dll")]
    private static extern void XamlCheckProcessRequirements();

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.Ordinal)) return SelfTest.Run();

        var xamlSelfTest = args.Contains("--xaml-self-test", StringComparer.Ordinal);
        App? app = null;
        Mutex? mutex = null;

        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
        {
            var exception = eventArgs.ExceptionObject as Exception
                ?? new Exception($"Unhandled non-Exception object: {eventArgs.ExceptionObject}");
            StartupDiagnostics.Write(exception, "AppDomain.UnhandledException");
        };

        try
        {
            var forceSetup = args.Contains("--setup", StringComparer.Ordinal);
            if (!xamlSelfTest)
            {
                mutex = new Mutex(initiallyOwned: true, "Local\\GitHubDeliveryAuthority-v1", out var createdNew);
                if (!createdNew) return 0;
            }

            StartupDiagnostics.Clear();
            XamlCheckProcessRequirements();
            WinRT.ComWrappersSupport.InitializeComWrappers();
            Application.Start(callbackParams =>
            {
                _ = callbackParams;
                var dispatcher = DispatcherQueue.GetForCurrentThread();
                SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(dispatcher));
                app = new App(forceSetup, xamlSelfTest);
            });
            return xamlSelfTest ? app?.ExitCode ?? 1 : 0;
        }
        catch (Exception exception)
        {
            StartupDiagnostics.Write(exception, "Program.Main");
            return 1;
        }
        finally
        {
            mutex?.Dispose();
        }
    }
}
