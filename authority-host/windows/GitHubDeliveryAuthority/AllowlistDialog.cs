namespace GitHubDeliveryAuthority;

internal sealed class AllowlistDialog : Form
{
    private readonly StateStore _store;
    private readonly ListBox _repos = new() { Dock = DockStyle.Fill };
    private readonly TextBox _repo = new() { Width = 300, PlaceholderText = "OWNER/REPO" };

    public AllowlistDialog(StateStore store)
    {
        _store = store;
        Text = "GitHub Delivery Authority — Repository Allowlist";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 660;
        Height = 460;
        MinimumSize = new Size(600, 400);
        BackColor = GitHubTheme.Canvas;
        ForeColor = GitHubTheme.TextPrimary;
        Font = GitHubTheme.UiFont(9.75f);

        GitHubTheme.StyleTextBox(_repo);
        _repos.BorderStyle = BorderStyle.FixedSingle;
        _repos.BackColor = Color.White;
        _repos.ForeColor = GitHubTheme.TextPrimary;
        _repos.Font = GitHubTheme.MonoFont(10f);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 5, ColumnCount = 1, Padding = new Padding(24, 18, 24, 18), BackColor = GitHubTheme.Canvas };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(GitHubTheme.BuildHeader("ALLOWLIST"), 0, 0);
        layout.Controls.Add(new Label
        {
            Text = "Repository Allowlist",
            Font = GitHubTheme.UiFont(18f, FontStyle.Bold),
            ForeColor = GitHubTheme.TextPrimary,
            AutoSize = true,
            Margin = new Padding(0, 16, 0, 2),
        }, 0, 1);
        layout.Controls.Add(new Label
        {
            Text = "Only explicitly allowlisted repositories may receive trusted grants. Changes require Windows Hello.",
            AutoSize = true,
            ForeColor = GitHubTheme.TextSecondary,
            MaximumSize = new Size(600, 0),
            Margin = new Padding(0, 0, 0, 10),
        }, 0, 2);
        layout.Controls.Add(_repos, 0, 3);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
        var add = new Button { Text = "Add" };
        var remove = new Button { Text = "Remove selected" };
        var close = new Button { Text = "Close", DialogResult = DialogResult.OK };
        GitHubTheme.StyleButton(add, primary: true);
        GitHubTheme.StyleButton(remove);
        GitHubTheme.StyleButton(close);
        add.Click += AddAsync;
        remove.Click += RemoveAsync;
        buttons.Controls.Add(_repo);
        buttons.Controls.Add(add);
        buttons.Controls.Add(remove);
        buttons.Controls.Add(close);
        layout.Controls.Add(buttons, 0, 4);
        Controls.Add(layout);
        AcceptButton = add;
        CancelButton = close;
        Reload();
    }

    private async void AddAsync(object? sender, EventArgs e)
    {
        var repo = _repo.Text.Trim();
        if (repo.Length == 0) return;
        if (!await VerifyHelloAsync($"Allow github-delivery trusted grants for {repo}")) return;
        try
        {
            _store.SetRepositoryAllowed(repo, true, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            _repo.Clear();
            Reload();
        }
        catch (AuthorityException error)
        {
            MessageBox.Show(this, error.Code, "Allowlist update failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async void RemoveAsync(object? sender, EventArgs e)
    {
        if (_repos.SelectedItem is not string repo) return;
        if (!await VerifyHelloAsync($"Remove {repo} from the github-delivery authority allowlist")) return;
        try
        {
            _store.SetRepositoryAllowed(repo, false, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            Reload();
        }
        catch (AuthorityException error)
        {
            MessageBox.Show(this, error.Code, "Allowlist update failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task<bool> VerifyHelloAsync(string message)
    {
        var verification = await HelloVerifier.VerifyAsync(Handle, message);
        if (verification.Verified) return true;

        var failure = verification.FailureMessage ?? "Windows Hello verification did not succeed.";
        if (!verification.CanOpenSignInOptions)
        {
            MessageBox.Show(this, failure, "Windows Hello required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }

        var choice = MessageBox.Show(
            this,
            $"{failure}\n\nOpen Windows sign-in options now?",
            "Windows Hello required",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (choice == DialogResult.Yes)
        {
            var result = WindowsSettings.OpenSignInOptions();
            if (!result.Opened)
            {
                MessageBox.Show(this, result.Error ?? "Windows sign-in options could not be opened.", "Windows Settings", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        return false;
    }

    private void Reload()
    {
        _repos.Items.Clear();
        foreach (var repo in _store.ListAllowedRepositories()) _repos.Items.Add(repo);
    }
}
