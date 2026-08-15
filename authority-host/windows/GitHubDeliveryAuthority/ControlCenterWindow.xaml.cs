using System.Globalization;
using System.Text.Json;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Graphics;

namespace GitHubDeliveryAuthority;

internal sealed partial class ControlCenterWindow : Window
{
    private sealed record BranchLeaseListItem(string LeaseId, string Display)
    {
        public override string ToString() => Display;
    }

    private sealed record RepositoryListItem(string Repo, string Display)
    {
        public override string ToString() => Display;
    }

    private sealed record HostVersionInfo(string Version, string SourceCommit);

    private readonly StateStore _store;
    private readonly AppWindow _appWindow;
    private bool _allowClose;

    public ControlCenterWindow(StateStore store)
    {
        InitializeComponent();
        _appWindow = ResolveAppWindow();
        TrySetWindowIcon();
        _appWindow.Closing += OnAppWindowClosing;
        _store = store;
        Activated += (_, _) => Refresh();
        TryResize(1080, 760);
    }

    public void ShowControlCenter()
    {
        Refresh();
        _appWindow.Show();
        Activate();
    }

    public void PrepareForExit()
    {
        _allowClose = true;
    }

    private void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_allowClose) return;
        args.Cancel = true;
        sender.Hide();
    }

    private void Refresh()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        _store.RecordExpiredBranchLeases(now);
        var repositories = _store.ListAllowedRepositories();
        AllowlistedCount.Text = repositories.Count.ToString(CultureInfo.InvariantCulture);
        AllowlistList.ItemsSource = repositories.Count == 0
            ? new[] { new RepositoryListItem(string.Empty, "No repositories allowlisted") }
            : repositories.Select(repo => new RepositoryListItem(repo, $"▣  {repo}")).ToArray();
        AllowlistList.SelectedItem = null;
        RemoveRepositoryButton.IsEnabled = false;

        var events = _store.ListRecentAuditEvents(50);
        ActivityList.ItemsSource = events.Count == 0
            ? new[] { "No audit events recorded yet." }
            : events.Select(FormatAuditEvent).ToArray();

        var leases = _store.ListActiveBranchLeases(now);
        GrantList.ItemsSource = leases.Count == 0
            ? new[] { new BranchLeaseListItem(string.Empty, "No active branch leases.") }
            : leases.Select(lease => new BranchLeaseListItem(lease.LeaseId, FormatBranchLease(lease, now))).ToArray();
        GrantList.SelectedItem = null;
        RevokeGrantButton.IsEnabled = false;
        ActiveGrantCount.Text = leases.Count.ToString(CultureInfo.InvariantCulture);

        var today = DateTimeOffset.Now.Date;
        var todayEvents = events.Where(entry => DateTimeOffset.FromUnixTimeSeconds(entry.CreatedAt).ToLocalTime().Date == today).ToArray();
        ApprovedTodayCount.Text = todayEvents.Count(entry => entry.EventType is "approval_granted" or "branch_lease_used").ToString(CultureInfo.InvariantCulture);
        DeniedTodayCount.Text = todayEvents.Count(entry => entry.EventType == "approval_denied").ToString(CultureInfo.InvariantCulture);
        ExpiredTodayCount.Text = todayEvents.Count(entry => entry.EventType.EndsWith("_expired", StringComparison.Ordinal)).ToString(CultureInfo.InvariantCulture);

        RefreshConfiguration();
        RefreshInstallationStatus();
        DiagnosticsUpdated.Text = $"Updated {DateTimeOffset.Now:t}";
    }

    private void RefreshConfiguration()
    {
        try
        {
            var config = UserConfigStore.Read();
            var display = UserConfigStore.DisplayMode(config.AuthorityMode);
            ProtectionModeText.Text = display;
            OffModeRadio.IsChecked = config.AuthorityMode == "off";
            SensitiveModeRadio.IsChecked = config.AuthorityMode == "high-assurance";
            AllModeRadio.IsChecked = config.AuthorityMode == "all";
            ConfigPathText.Text = UserConfigStore.ConfigPath;
        }
        catch (Exception error)
        {
            ProtectionModeText.Text = "Configuration error";
            SettingsStatusText.Text = error.Message;
            ConfigPathText.Text = UserConfigStore.ConfigPath;
        }
    }

    private void RefreshInstallationStatus()
    {
        try
        {
            var info = ReadHostVersionInfo();
            HostVersionText.Text = info?.Version ?? "Legacy / unversioned";
            HostSourceText.Text = info?.SourceCommit ?? "No release metadata found";
        }
        catch (Exception error)
        {
            HostVersionText.Text = "Version metadata error";
            HostSourceText.Text = error.Message;
        }
    }

    private static HostVersionInfo? ReadHostVersionInfo()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "authority-host-version.json");
        if (!File.Exists(path)) return null;
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        var root = document.RootElement;
        if (root.GetProperty("schemaVersion").GetInt32() != 1 ||
            root.GetProperty("kind").GetString() != "github-delivery/authority-host-version")
            throw new InvalidOperationException("authority_host_version_metadata_invalid");
        var version = root.GetProperty("version").GetString();
        var sourceCommit = root.GetProperty("sourceCommit").GetString();
        if (string.IsNullOrWhiteSpace(version) || string.IsNullOrWhiteSpace(sourceCommit))
            throw new InvalidOperationException("authority_host_version_metadata_invalid");
        return new HostVersionInfo(version, sourceCommit);
    }

    private static string FormatAuditEvent(AuditEventRecord entry)
    {
        var local = DateTimeOffset.FromUnixTimeSeconds(entry.CreatedAt).ToLocalTime();
        var repo = entry.Repo ?? "Authority";
        var branch = string.IsNullOrEmpty(entry.Branch) ? string.Empty : $" [{entry.Branch}]";
        var action = entry.EventType.Replace('_', ' ');
        return $"{local:HH:mm}    {repo}{branch}    {action}    {entry.Outcome}    Local user";
    }

    private static string FormatBranchLease(BranchLeaseRecord lease, long now)
    {
        var remaining = Math.Max(0, lease.ExpiresAt - now);
        var minutes = Math.Max(1, (int)Math.Ceiling(remaining / 60d));
        return $"{lease.Repo}  •  {lease.Branch}  •  {minutes} min remaining";
    }

    private void Navigation_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        var showSettings = args.IsSettingsSelected;
        SettingsPage.Visibility = showSettings ? Visibility.Visible : Visibility.Collapsed;
        OverviewPage.Visibility = showSettings ? Visibility.Collapsed : Visibility.Visible;
        if (showSettings) Refresh();
    }

    private void AllowlistList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        RemoveRepositoryButton.IsEnabled =
            AllowlistList.SelectedItem is RepositoryListItem item && !string.IsNullOrEmpty(item.Repo);
    }

    private async void AddRepository_Click(object sender, RoutedEventArgs e)
    {
        var input = new TextBox
        {
            Header = "Repository",
            PlaceholderText = "owner/repo",
        };
        var dialog = new ContentDialog
        {
            XamlRoot = RootLayout.XamlRoot,
            Title = "Add repository",
            Content = input,
            PrimaryButtonText = "Add",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
        };

        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var repo = input.Text.Trim();
        if (string.IsNullOrEmpty(repo))
        {
            AllowlistStatusText.Text = "Enter a repository as owner/repo.";
            return;
        }

        if (!await VerifyHelloAsync($"Add {repo} to Delivery Authority trusted grants?")) return;
        try
        {
            _store.SetRepositoryAllowed(repo, true, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            AllowlistStatusText.Text = $"Added {repo}.";
            Refresh();
        }
        catch (Exception error)
        {
            AllowlistStatusText.Text = $"Could not add repository: {error.Message}";
        }
    }

    private async void RemoveRepository_Click(object sender, RoutedEventArgs e)
    {
        if (AllowlistList.SelectedItem is not RepositoryListItem item || string.IsNullOrEmpty(item.Repo)) return;
        var repo = item.Repo;
        if (!await VerifyHelloAsync($"Remove {repo} from the Delivery Authority allowlist?")) return;

        try
        {
            _store.SetRepositoryAllowed(repo, false, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            AllowlistStatusText.Text = $"Removed {repo}.";
            Refresh();
        }
        catch (Exception error)
        {
            AllowlistStatusText.Text = $"Could not remove repository: {error.Message}";
        }
    }

    private async Task<bool> VerifyHelloAsync(string message)
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var verification = await HelloVerifier.VerifyAsync(hwnd, message);
        if (verification.Verified) return true;

        AllowlistStatusText.Text = verification.FailureMessage ?? "Windows Hello verification was cancelled.";
        if (verification.CanOpenSignInOptions) WindowsSettings.OpenSignInOptions();
        return false;
    }

    private void GrantList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        RevokeGrantButton.IsEnabled = GrantList.SelectedItem is BranchLeaseListItem item && !string.IsNullOrEmpty(item.LeaseId);
    }

    private void RevokeGrant_Click(object sender, RoutedEventArgs e)
    {
        if (GrantList.SelectedItem is not BranchLeaseListItem item || string.IsNullOrEmpty(item.LeaseId)) return;
        _store.RevokeBranchLease(item.LeaseId, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        Refresh();
    }

    private void ApplyProtectionMode_Click(object sender, RoutedEventArgs e)
    {
        var mode = SensitiveModeRadio.IsChecked == true
            ? "high-assurance"
            : AllModeRadio.IsChecked == true
                ? "all"
                : "off";
        try
        {
            UserConfigStore.WriteAuthorityMode(mode);
            SettingsStatusText.Text = $"Saved: {UserConfigStore.DisplayMode(mode)}";
            Refresh();
        }
        catch (Exception error)
        {
            SettingsStatusText.Text = $"Could not save: {error.Message}";
        }
    }

    private void OpenSettings_Click(object sender, RoutedEventArgs e)
    {
        Navigation.SelectedItem = Navigation.SettingsItem;
    }

    private AppWindow ResolveAppWindow()
    {
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
        return AppWindow.GetFromWindowId(windowId)
            ?? throw new InvalidOperationException("control_center_app_window_unavailable");
    }

    private void TrySetWindowIcon()
    {
        try
        {
            var appWindow = _appWindow;
            var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "DeliveryAuthority.ico");
            if (File.Exists(iconPath)) appWindow.SetIcon(iconPath);
        }
        catch
        {
            // Window icon setup is best effort.
        }
    }

    private void TryResize(int width, int height)
    {
        try
        {
            _appWindow.Resize(new SizeInt32(width, height));
        }
        catch
        {
            // Sizing is best effort.
        }
    }
}
