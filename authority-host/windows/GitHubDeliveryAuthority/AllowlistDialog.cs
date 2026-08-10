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
        Width = 620;
        Height = 420;

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 3, ColumnCount = 1, Padding = new Padding(12) };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(new Label { Text = "Only explicitly allowlisted repositories may receive trusted grants. Changes require Windows Hello.", AutoSize = true }, 0, 0);
        layout.Controls.Add(_repos, 0, 1);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
        var add = new Button { Text = "Add", AutoSize = true };
        var remove = new Button { Text = "Remove selected", AutoSize = true };
        var close = new Button { Text = "Close", AutoSize = true, DialogResult = DialogResult.OK };
        add.Click += AddAsync;
        remove.Click += RemoveAsync;
        buttons.Controls.Add(_repo);
        buttons.Controls.Add(add);
        buttons.Controls.Add(remove);
        buttons.Controls.Add(close);
        layout.Controls.Add(buttons, 0, 2);
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
        MessageBox.Show(
            this,
            verification.FailureMessage ?? "Windows Hello verification did not succeed.",
            "Windows Hello required",
            MessageBoxButtons.OK,
            MessageBoxIcon.Warning);
        return false;
    }

    private void Reload()
    {
        _repos.Items.Clear();
        foreach (var repo in _store.ListAllowedRepositories()) _repos.Items.Add(repo);
    }
}
