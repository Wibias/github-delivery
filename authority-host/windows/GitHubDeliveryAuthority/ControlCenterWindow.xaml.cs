using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Graphics;

namespace GitHubDeliveryAuthority;

internal sealed partial class ControlCenterWindow : Window
{
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
        var repositories = _store.ListAllowedRepositories();
        AllowlistedCount.Text = repositories.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
        AllowlistList.ItemsSource = repositories.Count == 0
            ? new[] { "No repositories allowlisted" }
            : repositories.Select(repo => $"▣  {repo}     Allowed").ToArray();

        ActivityList.ItemsSource = new[]
        {
            "Existing authority approvals are recorded locally. Detailed event history lands in the audit-ledger PR.",
        };
        GrantList.ItemsSource = new[] { "No active temporary branch grants" };
        ActiveGrantCount.Text = "0";
        ApprovedTodayCount.Text = "—";
        DeniedTodayCount.Text = "—";
        ExpiredTodayCount.Text = "—";

        try
        {
            var mode = UserConfigStore.Read();
            var display = UserConfigStore.DisplayMode(mode.AuthorityMode);
            ProtectionModeText.Text = display;
            ProtectionModeSidebar.Text = display;
        }
        catch (Exception error)
        {
            ProtectionModeText.Text = "Configuration error";
            ProtectionModeSidebar.Text = "Configuration error";
            DiagnosticsUpdated.Text = error.Message;
        }
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
