namespace GitHubDeliveryAuthority;

internal sealed class ApprovalDialog : Form
{
    private readonly string _helloMessage;
    private readonly Button _approveButton;
    private bool _wasTopMost;
    public bool Approved { get; private set; }

    public ApprovalDialog(string title, IReadOnlyList<string> lines, string helloMessage)
    {
        _helloMessage = helloMessage;
        Text = title;
        StartPosition = FormStartPosition.CenterScreen;
        Width = 720;
        Height = 560;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = true;
        // The approval dialog must not be silently hidden behind other windows.
        // TopMost is only held while the dialog is actually shown so the user
        // sees the Windows Hello prompt; it is restored on close.
        TopMost = true;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 3,
            ColumnCount = 1,
            Padding = new Padding(16),
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        layout.Controls.Add(new Label
        {
            Text = "Review the exact GitHub mutations below. Windows Hello approves only this displayed batch.",
            Dock = DockStyle.Fill,
            AutoSize = true,
            Font = new Font(FontFamily.GenericSansSerif, 9, FontStyle.Bold),
        }, 0, 0);

        var details = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Fill,
            Font = new Font(FontFamily.GenericMonospace, 10),
            Text = string.Join(Environment.NewLine + Environment.NewLine, lines),
        };
        layout.Controls.Add(details, 0, 1);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
        };
        _approveButton = new Button { Text = "Approve with Windows Hello", AutoSize = true };
        var cancel = new Button { Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel };
        _approveButton.Click += ApproveAsync;
        buttons.Controls.Add(_approveButton);
        buttons.Controls.Add(cancel);
        layout.Controls.Add(buttons, 0, 2);
        Controls.Add(layout);
        AcceptButton = _approveButton;
        CancelButton = cancel;
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        _wasTopMost = TopMost;
        TopMost = true;
        Activate();
        FlashWindow();
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        // Re-assert foreground attention if the user switched away and back.
        if (Visible && !IsDisposed)
        {
            Activate();
            FlashWindow();
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        TopMost = _wasTopMost;
        base.OnFormClosed(e);
    }

    private void FlashWindow()
    {
        try
        {
            var info = new NativeMethods.FlashWindowInfo
            {
                cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.FlashWindowInfo>(),
                hwnd = Handle,
                dwFlags = NativeMethods.FlashWindowFlags.FLASHW_ALL | NativeMethods.FlashWindowFlags.FLASHW_TIMERNOFG,
                uCount = uint.MaxValue,
                dwTimeout = 0,
            };
            NativeMethods.FlashWindowEx(ref info);
        }
        catch
        {
            // Flash is best-effort; activation alone is the primary mechanism.
        }
    }

    private async void ApproveAsync(object? sender, EventArgs e)
    {
        _approveButton.Enabled = false;
        try
        {
            var verification = await HelloVerifier.VerifyAsync(Handle, _helloMessage);
            if (verification.Verified)
            {
                Approved = true;
                DialogResult = DialogResult.OK;
                Close();
            }
            else
            {
                MessageBox.Show(
                    this,
                    verification.FailureMessage ?? "Windows Hello verification did not succeed.",
                    "Authorization denied",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }
        finally
        {
            if (!IsDisposed) _approveButton.Enabled = true;
        }
    }
}
