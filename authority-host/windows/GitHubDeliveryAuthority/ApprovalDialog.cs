namespace GitHubDeliveryAuthority;

internal sealed class ApprovalDialog : Form
{
    private readonly string _helloMessage;
    private readonly Button _approveButton;
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
            Font = new Font(SystemFonts.MessageBoxFont, FontStyle.Bold),
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

    private async void ApproveAsync(object? sender, EventArgs e)
    {
        _approveButton.Enabled = false;
        try
        {
            if (await HelloVerifier.VerifyAsync(Handle, _helloMessage))
            {
                Approved = true;
                DialogResult = DialogResult.OK;
                Close();
            }
            else
            {
                MessageBox.Show(this, "Windows Hello verification did not succeed.", "Authorization denied", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        finally
        {
            if (!IsDisposed) _approveButton.Enabled = true;
        }
    }
}
