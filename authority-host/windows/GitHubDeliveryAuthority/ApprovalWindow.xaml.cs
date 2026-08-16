using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Graphics;

namespace GitHubDeliveryAuthority;

internal sealed partial class ApprovalWindow : Window
{
    private readonly string _helloMessage;
    private readonly string? _branch;
    private readonly TaskCompletionSource<ApprovalDecision> _completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _completed;

    public ApprovalWindow(IReadOnlyList<string> lines, string helloMessage, string? repo = null, string? branch = null)
    {
        InitializeComponent();
        _helloMessage = helloMessage;
        _branch = string.IsNullOrWhiteSpace(branch) ? null : branch.Trim();
        RepositoryText.Text = string.IsNullOrWhiteSpace(repo) ? "Administrative action" : repo;
        ActionText.Text = string.Join(Environment.NewLine + Environment.NewLine, lines);
        BranchGrantToggle.IsEnabled = _branch is not null;
        BranchGrantToggle.IsOn = false;
        BranchGrantDuration.IsEnabled = false;
        BranchGrantScopeText.Text = _branch is null
            ? "Unavailable: this batch does not resolve to one exact branch."
            : $"Branch: {_branch}";
        Closed += (_, _) => Complete(new ApprovalDecision(false));
        TrySetMinimumWindowSize(560, 640);
        TryResize(820, 760);
    }

    public Task<ApprovalDecision> ShowAsync()
    {
        Activate();
        return _completion.Task;
    }

    private async void Approve_Click(object sender, RoutedEventArgs e)
    {
        ApproveButton.IsEnabled = false;
        try
        {
            while (!_completed)
            {
                var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
                var verification = await HelloVerifier.VerifyAsync(hwnd, _helloMessage);
                if (verification.Verified)
                {
                    Complete(new ApprovalDecision(true, SelectedBranchLeaseMinutes()));
                    Close();
                    return;
                }

                var signInIsPrimary = !verification.CanRetry && verification.CanOpenSignInOptions;
                var dialog = new ContentDialog
                {
                    Title = "Windows Hello did not verify",
                    Content = verification.FailureMessage ?? "Windows Hello verification did not succeed.",
                    PrimaryButtonText = verification.CanRetry
                        ? "Retry"
                        : signInIsPrimary
                            ? "Sign-in options"
                            : string.Empty,
                    SecondaryButtonText = verification.CanRetry && verification.CanOpenSignInOptions
                        ? "Sign-in options"
                        : string.Empty,
                    CloseButtonText = "Cancel",
                    XamlRoot = RootLayout.XamlRoot,
                };
                if (dialog.XamlRoot is null) return;

                var result = await dialog.ShowAsync();
                if (verification.CanRetry && result == ContentDialogResult.Primary) continue;
                if (verification.CanOpenSignInOptions &&
                    (result == ContentDialogResult.Secondary || (signInIsPrimary && result == ContentDialogResult.Primary)))
                {
                    WindowsSettings.OpenSignInOptions();
                }
                return;
            }
        }
        finally
        {
            if (!_completed) ApproveButton.IsEnabled = true;
        }
    }

    private void BranchGrantToggle_Toggled(object sender, RoutedEventArgs e)
    {
        BranchGrantDuration.IsEnabled = BranchGrantToggle.IsEnabled && BranchGrantToggle.IsOn;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        Complete(new ApprovalDecision(false));
        Close();
    }

    private int? SelectedBranchLeaseMinutes()
    {
        if (_branch is null || !BranchGrantToggle.IsEnabled || !BranchGrantToggle.IsOn) return null;
        if (BranchGrantDuration.SelectedItem is not ComboBoxItem item) return null;
        return int.TryParse(item.Tag?.ToString(), out var minutes) && minutes is >= 1 and <= 10
            ? minutes
            : null;
    }

    private void Complete(ApprovalDecision decision)
    {
        if (_completed) return;
        _completed = true;
        _completion.TrySetResult(decision);
    }

    private AppWindow? TryResolveAppWindow()
    {
        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
            return AppWindow.GetFromWindowId(windowId);
        }
        catch
        {
            return null;
        }
    }

    private void TrySetMinimumWindowSize(int width, int height)
    {
        try
        {
            if (TryResolveAppWindow()?.Presenter is OverlappedPresenter presenter)
            {
                presenter.PreferredMinimumWidth = width;
                presenter.PreferredMinimumHeight = height;
            }
        }
        catch
        {
            // Minimum sizing is best effort. The fixed shell expects the configured minimum dimensions.
        }
    }

    private void TryResize(int width, int height)
    {
        try
        {
            TryResolveAppWindow()?.Resize(new SizeInt32(width, height));
        }
        catch
        {
            // Sizing is best effort; WinUI still provides a functional window.
        }
    }
}
