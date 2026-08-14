using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Markup;

namespace GitHubDeliveryAuthority;

internal static class ControlCenterXamlSelfTest
{
    private const string PresentationNamespace = "http://schemas.microsoft.com/winfx/2006/xaml/presentation";
    private const string XamlNamespace = "http://schemas.microsoft.com/winfx/2006/xaml";

    private static readonly string[] AffectedFrameworkResourceKeys =
    {
        "CardBackgroundFillColorDefaultBrush",
        "CardStrokeColorDefaultBrush",
        "AccentTextFillColorPrimaryBrush",
        "SystemFillColorSuccessBackgroundBrush",
        "SystemFillColorSuccessBrush",
        "SystemFillColorCriticalBrush",
        "SystemFillColorCautionBrush"
    };

    private static readonly (string Name, string Xaml)[] Probes =
    {
        ("Grid", $"<Grid xmlns=\"{PresentationNamespace}\" />"),
        ("Local.StaticResource", $"<Grid xmlns=\"{PresentationNamespace}\" xmlns:x=\"{XamlNamespace}\"><Grid.Resources><SolidColorBrush x:Key=\"ProbeBrush\" Color=\"#FF7F7F7F\" /></Grid.Resources><Border Background=\"{{StaticResource ProbeBrush}}\" /></Grid>"),
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
        ("Style.AccentButtonStyle", $"<Button xmlns=\"{PresentationNamespace}\" Style=\"{{StaticResource AccentButtonStyle}}\" />"),
        ("Control.Button", $"<Button xmlns=\"{PresentationNamespace}\" Content=\"Probe\" />"),
        ("Control.RadioButton", $"<RadioButton xmlns=\"{PresentationNamespace}\" Content=\"Probe\" />"),
        ("Control.ListView", $"<ListView xmlns=\"{PresentationNamespace}\" SelectionMode=\"Single\" />"),
        ("Control.ListViewItem", $"<ListView xmlns=\"{PresentationNamespace}\"><ListViewItem Content=\"Probe\" /></ListView>"),
        ("Control.ScrollViewer", $"<ScrollViewer xmlns=\"{PresentationNamespace}\"><TextBlock Text=\"Probe\" /></ScrollViewer>"),
        ("Control.FontIcon", $"<FontIcon xmlns=\"{PresentationNamespace}\" Glyph=\"&#xE80F;\" />"),
        ("Control.FontFamilyFallback", $"<TextBlock xmlns=\"{PresentationNamespace}\" FontFamily=\"Cascadia Mono, Consolas\" Text=\"Probe\" />"),
        ("Section.Navigation", WrapWithLocalResources(
            """
            <Border BorderBrush="{StaticResource AuthorityCardStrokeBrush}" BorderThickness="0,0,1,0" Background="{StaticResource AuthorityCardBackgroundBrush}">
                <Grid>
                    <Grid.RowDefinitions><RowDefinition Height="*" /><RowDefinition Height="Auto" /></Grid.RowDefinitions>
                    <ListView SelectionMode="Single" Padding="8,12,8,8">
                        <ListViewItem Tag="overview"><StackPanel Orientation="Horizontal" Spacing="10"><FontIcon Glyph="&#xE80F;" /><TextBlock Text="Overview" VerticalAlignment="Center" /></StackPanel></ListViewItem>
                        <ListViewItem Tag="activity"><StackPanel Orientation="Horizontal" Spacing="10"><FontIcon Glyph="&#xE823;" /><TextBlock Text="Activity" VerticalAlignment="Center" /></StackPanel></ListViewItem>
                        <ListViewItem Tag="allowlist"><StackPanel Orientation="Horizontal" Spacing="10"><FontIcon Glyph="&#xEA37;" /><TextBlock Text="Allowlist" VerticalAlignment="Center" /></StackPanel></ListViewItem>
                    </ListView>
                    <Border Grid.Row="1" Padding="12" Margin="8" CornerRadius="8" Background="{ThemeResource ApplicationPageBackgroundThemeBrush}" BorderBrush="{StaticResource AuthorityCardStrokeBrush}" BorderThickness="1">
                        <StackPanel Orientation="Horizontal" Spacing="10"><FontIcon Glyph="&#xE83D;" Foreground="{StaticResource AuthorityAccentBrush}" FontSize="18" /><StackPanel><TextBlock Text="Protection mode" FontWeight="SemiBold" /><TextBlock Text="Loading" Style="{StaticResource CaptionTextBlockStyle}" Opacity="0.72" /></StackPanel></StackPanel>
                    </Border>
                </Grid>
            </Border>
            """)),
        ("Section.OverviewMetrics", WrapWithLocalResources(
            """
            <Border Padding="18" CornerRadius="8" Background="{StaticResource AuthorityCardBackgroundBrush}" BorderBrush="{StaticResource AuthorityCardStrokeBrush}" BorderThickness="1">
                <Grid ColumnSpacing="0">
                    <Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition/><ColumnDefinition/><ColumnDefinition/><ColumnDefinition/></Grid.ColumnDefinitions>
                    <StackPanel Grid.Column="0" HorizontalAlignment="Center" Spacing="3"><FontIcon Glyph="&#xE83D;" Foreground="{StaticResource AuthorityAccentBrush}"/><TextBlock Text="0" FontSize="22" FontWeight="SemiBold"/><TextBlock Text="Repositories" Style="{StaticResource CaptionTextBlockStyle}"/></StackPanel>
                    <StackPanel Grid.Column="1" HorizontalAlignment="Center" Spacing="3"><FontIcon Glyph="&#xE8D7;" Foreground="{StaticResource AuthorityAccentBrush}"/><TextBlock Text="0" FontSize="22" FontWeight="SemiBold"/><TextBlock Text="Active" Style="{StaticResource CaptionTextBlockStyle}"/></StackPanel>
                    <StackPanel Grid.Column="2" HorizontalAlignment="Center" Spacing="3"><FontIcon Glyph="&#xE73E;" Foreground="{StaticResource AuthoritySuccessBrush}"/><TextBlock Text="0" FontSize="22" FontWeight="SemiBold"/><TextBlock Text="Approved" Style="{StaticResource CaptionTextBlockStyle}"/></StackPanel>
                    <StackPanel Grid.Column="3" HorizontalAlignment="Center" Spacing="3"><FontIcon Glyph="&#xE711;" Foreground="{StaticResource AuthorityCriticalBrush}"/><TextBlock Text="0" FontSize="22" FontWeight="SemiBold"/><TextBlock Text="Denied" Style="{StaticResource CaptionTextBlockStyle}"/></StackPanel>
                    <StackPanel Grid.Column="4" HorizontalAlignment="Center" Spacing="3"><FontIcon Glyph="&#xE823;" Foreground="{StaticResource AuthorityCautionBrush}"/><TextBlock Text="0" FontSize="22" FontWeight="SemiBold"/><TextBlock Text="Expired" Style="{StaticResource CaptionTextBlockStyle}"/></StackPanel>
                </Grid>
            </Border>
            """)),
        ("Section.OverviewActivity", WrapWithLocalResources(
            """
            <Grid ColumnSpacing="16">
                <Grid.ColumnDefinitions><ColumnDefinition Width="2.15*"/><ColumnDefinition Width="1*"/></Grid.ColumnDefinitions>
                <Border Grid.Column="0" Padding="16" CornerRadius="8" Background="{StaticResource AuthorityCardBackgroundBrush}" BorderBrush="{StaticResource AuthorityCardStrokeBrush}" BorderThickness="1">
                    <StackPanel Spacing="12"><Grid><TextBlock Text="Recent activity / Audit trail" FontWeight="SemiBold"/><Button Content="View full activity" HorizontalAlignment="Right" Style="{StaticResource AccentButtonStyle}" Padding="9,3" IsEnabled="False"/></Grid><ListView SelectionMode="None" IsItemClickEnabled="False" MinHeight="280" /></StackPanel>
                </Border>
                <StackPanel Grid.Column="1" Spacing="16"><Border Padding="16" CornerRadius="8" Background="{StaticResource AuthorityCardBackgroundBrush}" BorderBrush="{StaticResource AuthorityCardStrokeBrush}" BorderThickness="1"><StackPanel Spacing="10"><TextBlock Text="Repository allowlist" FontWeight="SemiBold"/><ListView SelectionMode="None" MinHeight="135"/></StackPanel></Border></StackPanel>
            </Grid>
            """)),
        ("Section.Settings", WrapWithLocalResources(
            """
            <Border Padding="20" CornerRadius="8" Background="{StaticResource AuthorityCardBackgroundBrush}" BorderBrush="{StaticResource AuthorityCardStrokeBrush}" BorderThickness="1">
                <StackPanel Spacing="16">
                    <TextBlock Text="Protection mode" FontWeight="SemiBold" FontSize="16" />
                    <RadioButton GroupName="ProtectionMode" Content="Off" />
                    <TextBlock Text="No Windows Hello prompts." Margin="28,-10,0,0" Opacity="0.70" TextWrapping="Wrap" />
                    <RadioButton GroupName="ProtectionMode" Content="Sensitive actions (Recommended)" />
                    <TextBlock Text="Require Windows Hello for sensitive mutations." Margin="28,-10,0,0" Opacity="0.70" TextWrapping="Wrap" />
                    <RadioButton GroupName="ProtectionMode" Content="Every GitHub write" />
                    <StackPanel Orientation="Horizontal" Spacing="12"><Button Content="Apply" Style="{StaticResource AccentButtonStyle}" /><TextBlock Text="Status" VerticalAlignment="Center" Opacity="0.72" /></StackPanel>
                </StackPanel>
            </Border>
            """))
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

    private static string WrapWithLocalResources(string content)
    {
        return "<Grid xmlns=\"" + PresentationNamespace + "\" xmlns:x=\"" + XamlNamespace + "\">" +
               "<Grid.Resources>" +
               "<SolidColorBrush x:Key=\"AuthorityCardBackgroundBrush\" Color=\"#147F7F7F\" />" +
               "<SolidColorBrush x:Key=\"AuthorityCardStrokeBrush\" Color=\"#337F7F7F\" />" +
               "<SolidColorBrush x:Key=\"AuthorityAccentBrush\" Color=\"#4CC2FF\" />" +
               "<SolidColorBrush x:Key=\"AuthoritySuccessBackgroundBrush\" Color=\"#2634A853\" />" +
               "<SolidColorBrush x:Key=\"AuthoritySuccessBrush\" Color=\"#57C36B\" />" +
               "<SolidColorBrush x:Key=\"AuthorityCriticalBrush\" Color=\"#E65A5A\" />" +
               "<SolidColorBrush x:Key=\"AuthorityCautionBrush\" Color=\"#E0A52B\" />" +
               "</Grid.Resources>" + content + "</Grid>";
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

        AppendApplicationResourceReport(report);
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

    private static void AppendApplicationResourceReport(StringBuilder report)
    {
        report.AppendLine("ApplicationResources:");

        var resources = Application.Current?.Resources;
        if (resources is null)
        {
            report.AppendLine("  Application.Current.Resources: unavailable");
            return;
        }

        report.AppendLine($"  merged-dictionaries={resources.MergedDictionaries.Count}; theme-dictionaries={resources.ThemeDictionaries.Count}");
        foreach (var key in AffectedFrameworkResourceKeys)
        {
            report.AppendLine($"  app[{key}]={DescribeLookup(resources, key)}");
        }

        for (var index = 0; index < resources.MergedDictionaries.Count; index++)
        {
            var merged = resources.MergedDictionaries[index];
            report.AppendLine($"  merged[{index}]={merged.GetType().FullName}");
            foreach (var key in AffectedFrameworkResourceKeys)
            {
                report.AppendLine($"    [{key}]={DescribeLookup(merged, key)}");
            }
        }

        foreach (var themeName in new[] { "Default", "Dark", "Light", "HighContrast" })
        {
            try
            {
                if (!resources.ThemeDictionaries.ContainsKey(themeName))
                {
                    report.AppendLine($"  theme[{themeName}]=missing");
                    continue;
                }

                if (resources.ThemeDictionaries[themeName] is not ResourceDictionary themeDictionary)
                {
                    report.AppendLine($"  theme[{themeName}]=unexpected-type:{resources.ThemeDictionaries[themeName]?.GetType().FullName ?? "null"}");
                    continue;
                }

                report.AppendLine($"  theme[{themeName}]=ResourceDictionary");
                foreach (var key in AffectedFrameworkResourceKeys)
                {
                    report.AppendLine($"    [{key}]={DescribeLookup(themeDictionary, key)}");
                }
            }
            catch (Exception exception)
            {
                report.AppendLine($"  theme[{themeName}]=ERROR HRESULT=0x{exception.HResult:X8} {exception.Message}");
            }
        }
    }

    private static string DescribeLookup(ResourceDictionary dictionary, string key)
    {
        try
        {
            if (!dictionary.ContainsKey(key)) return "missing";
            var value = dictionary[key];
            return value is null ? "present:null" : $"present:{value.GetType().FullName}";
        }
        catch (Exception exception)
        {
            return $"ERROR HRESULT=0x{exception.HResult:X8} {exception.Message}";
        }
    }
}
