using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.UI.Xaml.Markup;

namespace GitHubDeliveryAuthority;

internal static class ControlCenterXamlSelfTest
{
    private const string PresentationNamespace = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";

    private static readonly (string Name, string Xaml)[] Probes =
    {
        ("Grid", $"<Grid xmlns=\"{PresentationNamespace}\" />"),
        ("NavigationView", $"<NavigationView xmlns=\"{PresentationNamespace}\" IsSettingsVisible=\"False\" />"),
        ("NavigationViewItem.Home", $"<NavigationView xmlns=\"{PresentationNamespace}\" IsSettingsVisible=\"False\"><NavigationView.MenuItems><NavigationViewItem Content=\"Overview\"><NavigationViewItem.Icon><SymbolIcon Symbol=\"Home\" /></NavigationViewItem.Icon></NavigationViewItem></NavigationView.MenuItems></NavigationView>"),
        ("NavigationViewItem.Clock", $"<NavigationView xmlns=\"{PresentationNamespace}\" IsSettingsVisible=\"False\"><NavigationView.MenuItems><NavigationViewItem Content=\"Activity\"><NavigationViewItem.Icon><SymbolIcon Symbol=\"Clock\" /></NavigationViewItem.Icon></NavigationViewItem></NavigationView.MenuItems></NavigationView>"),
        ("NavigationViewItem.List", $"<NavigationView xmlns=\"{PresentationNamespace}\" IsSettingsVisible=\"False\"><NavigationView.MenuItems><NavigationViewItem Content=\"Allowlist\"><NavigationViewItem.Icon><SymbolIcon Symbol=\"List\" /></NavigationViewItem.Icon></NavigationViewItem></NavigationView.MenuItems></NavigationView>"),
        ("NavigationViewItem.Permissions", $"<NavigationView xmlns=\"{PresentationNamespace}\" IsSettingsVisible=\"False\"><NavigationView.MenuItems><NavigationViewItem Content=\"Temporary grants\"><NavigationViewItem.Icon><SymbolIcon Symbol=\"Permissions\" /></NavigationViewItem.Icon></NavigationViewItem></NavigationView.MenuItems></NavigationView>"),
        ("NavigationViewItem.ReportHacked", $"<NavigationView xmlns=\"{PresentationNamespace}\" IsSettingsVisible=\"False\"><NavigationView.MenuItems><NavigationViewItem Content=\"Diagnostics\"><NavigationViewItem.Icon><SymbolIcon Symbol=\"ReportHacked\" /></NavigationViewItem.Icon></NavigationViewItem></NavigationView.MenuItems></NavigationView>"),
        ("NavigationViewItem.Setting", $"<NavigationView xmlns=\"{PresentationNamespace}\" IsSettingsVisible=\"False\"><NavigationView.MenuItems><NavigationViewItem Content=\"Settings\"><NavigationViewItem.Icon><SymbolIcon Symbol=\"Setting\" /></NavigationViewItem.Icon></NavigationViewItem></NavigationView.MenuItems></NavigationView>"),
        ("Theme.ApplicationPageBackgroundThemeBrush", $"<Grid xmlns=\"{PresentationNamespace}\" Background=\"{{ThemeResource ApplicationPageBackgroundThemeBrush}}\" />"),
        ("Theme.CardBackgroundFillColorDefaultBrush", $"<Border xmlns=\"{PresentationNamespace}\" Background=\"{{ThemeResource CardBackgroundFillColorDefaultBrush}}\" />"),
        ("Theme.CardStrokeColorDefaultBrush", $"<Border xmlns=\"{PresentationNamespace}\" BorderBrush=\"{{ThemeResource CardStrokeColorDefaultBrush}}\" />"),
        ("Theme.AccentTextFillColorPrimaryBrush", $"<TextBlock xmlns=\"{PresentationNamespace}\" Foreground=\"{{ThemeResource AccentTextFillColorPrimaryBrush}}\" />"),
        ("Theme.SystemFillColorSuccessBackgroundBrush", $"<Border xmlns=\"{PresentationNamespace}\" Background=\"{{ThemeResource SystemFillColorSuccessBackgroundBrush}}\" />"),
        ("Theme.SystemFillColorSuccessBrush", $"<TextBlock xmlns=\"{PresentationNamespace}\" Foreground=\"{{ThemeResource SystemFillColorSuccessBrush}}\" />"),
        ("Theme.SystemFillColorCriticalBrush", $"<TextBlock xmlns=\"{PresentationNamespace}\" Foreground=\"{{ThemeResource SystemFillColorCriticalBrush}}\" />"),
        ("Theme.SystemFillColorCautionBrush", $"<TextBlock xmlns=\"{PresentationNamespace}\" Foreground=\"{{ThemeResource SystemFillColorCautionBrush}}\" />"),
        ("Style.CaptionTextBlockStyle", $"<TextBlock xmlns=\"{PresentationNamespace}\" Style=\"{{StaticResource CaptionTextBlockStyle}}\" />"),
        ("Style.TitleTextBlockStyle", $"<TextBlock xmlns=\"{PresentationNamespace}\" Style=\"{{StaticResource TitleTextBlockStyle}}\" />"),
        ("Style.AccentButtonStyle", $"<Button xmlns=\"{PresentationNamespace}\" Style=\"{{StaticResource AccentButtonStyle}}\" />")
    };

    public static int Run()
    {
        WriteProbeReport();

        var root = Path.Combine(Path.GetTempPath(), "github-delivery-authority-xaml-self-test", Guid.NewGuid().ToString("N"));
        try
        {
            using var store = new StateStore(Path.Combine(root, "authority.db"));
            var window = new ControlCenterWindow(store);
            window.Close();
            return 0;
        }
        catch (Exception exception)
        {
            StartupDiagnostics.Write(exception, "ControlCenterXamlSelfTest");
            return 1;
        }
        finally
        {
            try
            {
                if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
            }
            catch
            {
                // The self-test must report XAML construction, not cleanup failures.
            }
        }
    }

    private static void WriteProbeReport()
    {
        var report = new StringBuilder();
        report.AppendLine($"OS: {RuntimeInformation.OSDescription}");
        report.AppendLine($"OSVersion: {Environment.OSVersion.Version}");
        report.AppendLine($"Architecture: process={RuntimeInformation.ProcessArchitecture}; os={RuntimeInformation.OSArchitecture}");
        report.AppendLine($"Culture: {CultureInfo.CurrentCulture.Name}; UI culture: {CultureInfo.CurrentUICulture.Name}");
        report.AppendLine($"BaseDirectory: {AppContext.BaseDirectory}");
        report.AppendLine($"CurrentDirectory: {Environment.CurrentDirectory}");
        report.AppendLine("Loaded Microsoft runtime modules:");

        try
        {
            using var process = Process.GetCurrentProcess();
            foreach (ProcessModule module in process.Modules)
            {
                if (!module.ModuleName.StartsWith("Microsoft.", StringComparison.OrdinalIgnoreCase) &&
                    !module.ModuleName.Contains("WindowsApp", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                string version;
                try
                {
                    version = module.FileVersionInfo.FileVersion ?? "unknown";
                }
                catch
                {
                    version = "unknown";
                }

                report.AppendLine($"  {module.ModuleName} | {version} | {module.FileName}");
            }
        }
        catch (Exception exception)
        {
            report.AppendLine($"  module-enumeration-failed: HRESULT=0x{exception.HResult:X8} {exception.Message}");
        }

        StartupDiagnostics.WriteMessage("ControlCenterXamlProbe", report.ToString());

        foreach (var probe in Probes)
        {
            StartupDiagnostics.WriteMessage("ControlCenterXamlProbe", $"BEGIN {probe.Name}");
            try
            {
                _ = XamlReader.Load(probe.Xaml);
                StartupDiagnostics.WriteMessage("ControlCenterXamlProbe", $"PASS {probe.Name}");
            }
            catch (Exception exception)
            {
                StartupDiagnostics.WriteMessage(
                    "ControlCenterXamlProbe",
                    $"FAIL {probe.Name} | HRESULT=0x{exception.HResult:X8} | {exception.Message}");
            }
        }
    }
}
