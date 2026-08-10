using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Graphics;

namespace GitHubDeliveryAuthority;

internal sealed partial class ApprovalWindow : Window
{
    private readonly string _helloMessage;
    private readonly TaskCompletionSource<bool> _completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool _completed;

    public ApprovalWindow(IReadOnlyList<string> lines, string helloMessage, string? repo = null)
    {
        InitializeComponent();
        _helloMessage = helloMessage;
        RepositoryText.Text = string.IsNullOrWhiteSpace(repo) ? "Administrative action" : repo;
        ActionText.Text = string.Join(Environment.NewLine + Environment.NewLine, lines);
        Closed += (_, _) => Complete(false);
        TryResize(720, 690);
    }

    public Task<bool> ShowAsync()
    {
        Activate();
        return _completion.Task;
    }

    private async void Approve_Click(object sender, RoutedEventArgs e)
    {
        ApproveButton.IsEnabled = false;
        try
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            var verification = await HelloVerifier.VerifyAsync(hwnd, _helloMessage);
            if (verification.Verified)
            {
                Complete(true);
                Close();
                return;
            }
            var dialog = new ContentDialog
            {
                Title = "Authorization denied",
                Content = verification.FailureMessage ?? "Windows Hello verification did not succeed.",
                CloseButtonText = "OK",
                XamlRoot = (Content as FrameworkElement)?.XamlRoot,
            };
            if (dialog.XamlRoot is not null) await dialog.ShowAsync();
        }
        finally
        {
            if (!_completed) ApproveButton.IsEnabled = true;
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        Complete(false);
        Close();
    }

    private void Complete(bool approved)
    {
        if (_completed) return;
        _completed = true;
        _completion.TrySetResult(approved);
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
            // Sizing is best effort; WinUI still provides a functional window.
        }
    }
}
