using System.Globalization;
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

    private readonly StateStore _store;

    public ControlCenterWindow(StateStore store)
    {
        InitializeComponent();
        _store = store;
        Activated += (_, _) => Refresh();
        TryResize(1080, 760);
    }

    public void ShowControlCenter()
    {
        Refresh();
        Activate();
    }

    private void Refresh()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        _store.RecordExpiredBranchLeases(now);
        var repositories = _store.ListAllowedRepositories();
        AllowlistedCount.Text = repositories.Count.ToString(CultureInfo.InvariantCulture);
        AllowlistList.ItemsSource = repositories.Count == 0
            ? new[] { "No repositories allowlisted" }
            : repositories.Select(repo => $"▣  {repo}     Allowed").ToArray();

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

        try
        {
            var mode = UserConfigStore.Read();
            var display = UserConfigStore.DisplayMode(mode.AuthorityMode);
            ProtectionModeText.Text = display;
            ProtectionModeSidebar.Text = display;
            DiagnosticsUpdated.Text = $"Updated {DateTimeOffset.Now:t}";
        }
        catch (Exception error)
        {
            ProtectionModeText.Text = "Configuration error";
            ProtectionModeSidebar.Text = "Configuration error";
            DiagnosticsUpdated.Text = error.Message;
        }
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

    private void OpenSettings_Click(object sender, RoutedEventArgs e)
    {
        var settingsItem = Navigation.MenuItems
            .OfType<NavigationViewItem>()
            .FirstOrDefault(item => string.Equals(item.Tag?.ToString(), "settings", StringComparison.Ordinal));
        if (settingsItem is not null) Navigation.SelectedItem = settingsItem;
    }

    private void TryResize(int width, int height)
    {
        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
            AppWindow.GetFromWindowId(windowId)?.Resize(new SizeInt32(width, height));
        }
        catch
        {
            // Sizing is best effort.
        }
    }
}
