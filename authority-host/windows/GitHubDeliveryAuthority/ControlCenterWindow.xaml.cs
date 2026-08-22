using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Graphics;

namespace GitHubDeliveryAuthority;

internal sealed partial class ControlCenterWindow : Window
{
    private sealed record GrantListItem(string Kind, string Id, string Display)
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
    private readonly ObservableCollection<ActivityListItem> _activityItems = new();
    private string? _activitySnapshot;
    private string? _diagnosticsUpdatedText;
    private bool _allowClose;
    private bool _refreshingAutostart;

    public ControlCenterWindow(StateStore store)
    {
        InitializeComponent();
        _appWindow = ResolveAppWindow();
        TrySetMinimumWindowSize(720, 620);
        TrySetWindowIcon();
        _appWindow.Closing += OnAppWindowClosing;
        _store = store;
        ActivityList.ItemsSource = _activityItems;
        RootLayout.Loaded += (_, _) => QueueEdgeSpacingUpdate(RootLayout.ActualWidth);
        RootLayout.SizeChanged += (_, args) => QueueEdgeSpacingUpdate(args.NewSize.Width);
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
        _store.RecordExpiredPrSessions(now);
        var repositories = _store.ListAllowedRepositories();
        AllowlistedCount.Text = repositories.Count.ToString(CultureInfo.InvariantCulture);
        AllowlistList.ItemsSource = repositories.Count == 0
            ? new[] { new RepositoryListItem(string.Empty, "No repositories allowlisted") }
            : repositories.Select(repo => new RepositoryListItem(repo, $"▣  {repo}")).ToArray();
        AllowlistList.SelectedItem = null;
        RemoveRepositoryButton.IsEnabled = false;

        var events = _store.ListRecentAuditEvents(50);
        UpdateActivityList(events);

        var leases = _store.ListActiveBranchLeases(now);
        var sessions = _store.ListActivePrSessions(now);
        var grants = new List<GrantListItem>();
        grants.AddRange(leases.Select(lease => new GrantListItem("branch", lease.LeaseId, FormatBranchLease(lease, now))));
        grants.AddRange(sessions.Select(session => new GrantListItem("session", session.SessionId, FormatPrSession(session, now))));
        GrantList.ItemsSource = grants.Count == 0
            ? new[] { new GrantListItem(string.Empty, string.Empty, "No active branch leases or PR sessions.") }
            : grants.ToArray();
        GrantList.SelectedItem = null;
        RevokeGrantButton.IsEnabled = false;
        ActiveGrantCount.Text = grants.Count.ToString(CultureInfo.InvariantCulture);

        var today = DateTimeOffset.Now.Date;
        var todayEvents = events.Where(entry => DateTimeOffset.FromUnixTimeSeconds(entry.CreatedAt).ToLocalTime().Date == today).ToArray();
        ApprovedTodayCount.Text = todayEvents.Count(entry => entry.EventType is "approval_granted" or "branch_lease_used" or "pr_session_used").ToString(CultureInfo.InvariantCulture);
        DeniedTodayCount.Text = todayEvents.Count(entry => entry.EventType == "approval_denied").ToString(CultureInfo.InvariantCulture);
        ExpiredTodayCount.Text = todayEvents.Count(entry => entry.EventType.EndsWith("_expired", StringComparison.Ordinal)).ToString(CultureInfo.InvariantCulture);

        RefreshConfiguration();
        RefreshInstallationStatus();
        RefreshAutostart();
        DiagnosticsUpdated.Text = $"Updated {DateTimeOffset.Now:t}";
        var diagnosticsText = $"Updated {DateTimeOffset.Now:t}";
        if (!string.Equals(diagnosticsText, _diagnosticsUpdatedText, StringComparison.Ordinal))
        {
            _diagnosticsUpdatedText = diagnosticsText;
            DiagnosticsUpdated.Text = diagnosticsText;
        }
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

    private void RefreshAutostart()
    {
        try
        {
            _refreshingAutostart = true;
            var state = AuthorityStartup.Read();
            AutostartToggle.IsOn = state.Enabled;
            AutostartStatusText.Text = state.Enabled ? "Enabled" : "Disabled";
        }
        catch (Exception error)
        {
            AutostartStatusText.Text = $"Could not read auto-start: {error.Message}";
        }
        finally
        {
            _refreshingAutostart = false;
        }
    }

    private void AutostartToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_refreshingAutostart) return;
        try
        {
            var state = AuthorityStartup.Set(AutostartToggle.IsOn);
            AutostartStatusText.Text = state.Enabled ? "Enabled" : "Disabled";
        }
        catch (Exception error)
        {
            var message = $"Could not update auto-start: {error.Message}";
            RefreshAutostart();
            AutostartStatusText.Text = message;
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

    private void UpdateActivityList(IReadOnlyList<AuditEventRecord> events)
    {
        var nextItems = ActivityListBuilder.Build(events, DateTimeOffset.Now);
        var snapshot = ActivityListBuilder.BuildSnapshot(nextItems);
        if (string.Equals(snapshot, _activitySnapshot, StringComparison.Ordinal))
        {
            return;
        }

        _activitySnapshot = snapshot;
        _activityItems.Clear();
        foreach (var item in nextItems)
        {
            _activityItems.Add(item);
        }
    }

    private static string FormatBranchLease(BranchLeaseRecord lease, long now)
    {
        var remaining = Math.Max(0, lease.ExpiresAt - now);
        var minutes = Math.Max(1, (int)Math.Ceiling(remaining / 60d));
        return $"{lease.Repo}  •  {lease.Branch}  •  {minutes} min remaining";
    }

    private static string FormatPrSession(PrSessionRecord session, long now)
    {
        var remaining = Math.Max(0, session.ExpiresAt - now);
        var minutes = Math.Max(1, (int)Math.Ceiling(remaining / 60d));
        return session.ExpectedBase is string expectedBase
            ? $"{session.Repo}  •  PR #{session.Pr}  •  {session.Branch}  •  base {expectedBase}  •  {minutes} min remaining"
            : $"{session.Repo}  •  PR #{session.Pr}  •  {session.Branch}  •  {minutes} min remaining";
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
        RevokeGrantButton.IsEnabled = GrantList.SelectedItem is GrantListItem item && !string.IsNullOrEmpty(item.Id);
    }

    private void RevokeGrant_Click(object sender, RoutedEventArgs e)
    {
        if (GrantList.SelectedItem is not GrantListItem item || string.IsNullOrEmpty(item.Id)) return;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (item.Kind == "session") _store.RevokePrSession(item.Id, now);
        else _store.RevokeBranchLease(item.Id, now);
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

    private void QueueEdgeSpacingUpdate(double width)
    {
        if (width <= 0) return;
        RootLayout.DispatcherQueue.TryEnqueue(() => ApplyEdgeSpacing(width));
    }

    private void ApplyEdgeSpacing(double width)
    {
        var horizontal = Math.Clamp(Math.Round(width * 0.05), 28, 64);
        var (top, bottom) = width >= 1360
            ? (24d, 28d)
            : width >= 900
                ? (20d, 24d)
                : (16d, 20d);
        var padding = new Thickness(horizontal, top, horizontal, bottom);
        OverviewContent.Padding = padding;
        SettingsContent.Padding = padding;
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

    private void TrySetMinimumWindowSize(int width, int height)
    {
        try
        {
            if (_appWindow.Presenter is OverlappedPresenter presenter)
            {
                presenter.PreferredMinimumWidth = width;
                presenter.PreferredMinimumHeight = height;
            }
        }
        catch
        {
            // Minimum window sizing is best effort.
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
