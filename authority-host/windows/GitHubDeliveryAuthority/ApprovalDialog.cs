namespace GitHubDeliveryAuthority;

internal sealed class ApprovalDialog : Form
{
    private readonly string _helloMessage;
    private readonly Button _approveButton;
    private bool _wasTopMost;
    public bool Approved { get; private set; }

    public ApprovalDialog(string title, IReadOnlyList<string> lines, string helloMessage, string? repo = null)
    {
        _helloMessage = helloMessage;
        Text = title;
        StartPosition = FormStartPosition.CenterScreen;
        Width = 760;
        Height = 560;
        MinimumSize = new Size(680, 480);
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = true;
        BackColor = GitHubTheme.Canvas;
        ForeColor = GitHubTheme.TextPrimary;
        Font = GitHubTheme.UiFont(9.75f);
        // The approval dialog must not be silently hidden behind other windows.
        // TopMost is only held while the dialog is actually shown so the user
        // sees the Windows Hello prompt; it is restored on close.
        TopMost = true;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 5,
            ColumnCount = 1,
            BackColor = GitHubTheme.Canvas,
            Padding = new Padding(24, 18, 24, 18),
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        // Header: shield + app name + READY pill
        root.Controls.Add(GitHubTheme.BuildHeader("READY"), 0, 0);
        root.Controls.Add(new Label
        {
            Text = "Approve GitHub mutation",
            Font = GitHubTheme.UiFont(18f, FontStyle.Bold),
            ForeColor = GitHubTheme.TextPrimary,
            AutoSize = true,
            Margin = new Padding(0, 16, 0, 2),
        }, 0, 1);

        // Repo line in monospace, GitHub-style
        if (!string.IsNullOrWhiteSpace(repo))
        {
            root.Controls.Add(new Label
            {
                Text = repo,
                Font = GitHubTheme.MonoFont(10.5f),
                ForeColor = GitHubTheme.Accent,
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 10),
            }, 0, 2);
        }

        // Details panel: thin GitHub border, monospace mutation lines
        var details = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Fill,
            Font = GitHubTheme.MonoFont(10f),
            BackColor = Color.White,
            ForeColor = GitHubTheme.TextPrimary,
            BorderStyle = BorderStyle.FixedSingle,
            Text = string.Join(Environment.NewLine + Environment.NewLine, lines),
            Margin = new Padding(0, 4, 0, 4),
        };
        var detailsPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = GitHubTheme.Canvas,
            Margin = new Padding(0),
        };
        GitHubTheme.AddBorder(detailsPanel, GitHubTheme.Border);
        detailsPanel.Controls.Add(details);
        root.Controls.Add(detailsPanel, 0, 3);

        // Footer: security note + buttons
        var footer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            BackColor = GitHubTheme.Canvas,
            Margin = new Padding(0, 10, 0, 0),
        };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        footer.Controls.Add(new Label
        {
            Text = "Windows Hello approves only this displayed batch",
            Font = GitHubTheme.UiFont(9f),
            ForeColor = GitHubTheme.TextSecondary,
            AutoSize = true,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            Margin = new Padding(0),
        }, 0, 0);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
            WrapContents = false,
            Margin = new Padding(0),
        };
        _approveButton = new Button { Text = "Approve with Windows Hello" };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
        GitHubTheme.StyleButton(_approveButton, primary: true);
        GitHubTheme.StyleButton(cancel);
        _approveButton.Click += ApproveAsync;
        buttons.Controls.Add(_approveButton);
        buttons.Controls.Add(cancel);
        footer.Controls.Add(buttons, 1, 0);
        root.Controls.Add(footer, 0, 4);
        Controls.Add(root);
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
