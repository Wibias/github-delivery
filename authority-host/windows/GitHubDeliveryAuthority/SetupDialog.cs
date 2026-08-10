namespace GitHubDeliveryAuthority;

internal sealed class SetupDialog : Form
{
    private readonly StateStore _store;
    private readonly Label _status = new()
    {
        AutoSize = false,
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleLeft,
    };
    private readonly Button _settings = new() { Text = "Open Windows sign-in options", AutoSize = true, Visible = false };
    private readonly Button _checkAgain = new() { Text = "Check again", AutoSize = true };
    private readonly Button _verify = new() { Text = "Verify Windows Hello", AutoSize = true, Enabled = false };
    private readonly TextBox _repo = new() { Dock = DockStyle.Fill, Enabled = false };
    private readonly Button _addRepo = new() { Text = "Add repository", AutoSize = true, Enabled = false };
    private readonly Button _finish = new() { Text = "Close", AutoSize = true };
    private bool _helloTestPassed;

    public SetupDialog(StateStore store)
    {
        _store = store;
        Text = "GitHub Delivery Authority - Setup";
        Width = 680;
        Height = 430;
        MinimumSize = new Size(620, 390);
        StartPosition = FormStartPosition.CenterScreen;

        var heading = new Label
        {
            Text = "Set up GitHub Delivery Authority",
            AutoSize = true,
            Font = new Font(SystemFonts.MessageBoxFont?.FontFamily ?? FontFamily.GenericSansSerif, 14, FontStyle.Bold),
        };
        var intro = new Label
        {
            Text = "Windows Hello protects authority changes. A Windows Hello PIN is sufficient; a fingerprint reader or camera is not required.",
            AutoSize = true,
            MaximumSize = new Size(620, 0),
        };
        var helloHeading = new Label { Text = "1. Windows Hello readiness", AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont, FontStyle.Bold) };
        var verifyHeading = new Label { Text = "2. Test Windows Hello", AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont, FontStyle.Bold) };
        var repoHeading = new Label { Text = "3. Trust your first repository", AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont, FontStyle.Bold) };
        var repoHint = new Label { Text = "Repository (OWNER/REPO)", AutoSize = true };

        var readinessButtons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
        readinessButtons.Controls.Add(_checkAgain);
        readinessButtons.Controls.Add(_settings);

        var repoRow = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 2 };
        repoRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        repoRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        repoRow.Controls.Add(_repo, 0, 0);
        repoRow.Controls.Add(_addRepo, 1, 0);

        var footer = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
        footer.Controls.Add(_finish);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 1,
            RowCount = 11,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

        layout.Controls.Add(heading, 0, 0);
        layout.Controls.Add(intro, 0, 1);
        layout.Controls.Add(helloHeading, 0, 2);
        layout.Controls.Add(_status, 0, 3);
        layout.Controls.Add(readinessButtons, 0, 4);
        layout.Controls.Add(verifyHeading, 0, 5);
        layout.Controls.Add(_verify, 0, 6);
        layout.Controls.Add(repoHeading, 0, 7);
        layout.Controls.Add(repoHint, 0, 8);
        layout.Controls.Add(repoRow, 0, 9);
        layout.Controls.Add(footer, 0, 10);
        Controls.Add(layout);

        _checkAgain.Click += async (_, _) => await CheckReadinessAsync();
        _settings.Click += (_, _) => OpenSignInOptions();
        _verify.Click += async (_, _) => await VerifyHelloAsync();
        _addRepo.Click += async (_, _) => await AddRepositoryAsync();
        _finish.Click += (_, _) => Close();
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await CheckReadinessAsync();
    }

    private async Task CheckReadinessAsync()
    {
        SetBusy(true);
        _status.Text = "Checking Windows Hello...";
        _helloTestPassed = false;
        _repo.Enabled = false;
        _addRepo.Enabled = false;

        var readiness = await HelloVerifier.CheckReadinessAsync();
        _status.Text = readiness.Message;
        _settings.Visible = readiness.CanOpenSignInOptions;
        _verify.Enabled = readiness.Available;
        SetBusy(false);
    }

    private async Task VerifyHelloAsync()
    {
        var verification = await HelloVerifier.VerifyAsync(Handle, "Verify Windows Hello for GitHub Delivery Authority setup");
        if (!verification.Verified)
        {
            _helloTestPassed = false;
            _repo.Enabled = false;
            _addRepo.Enabled = false;
            ShowVerificationFailure(verification);
            return;
        }

        _helloTestPassed = true;
        _status.Text = "Windows Hello verification succeeded. Enter the first repository you want to trust.";
        _repo.Enabled = true;
        _addRepo.Enabled = true;
        _repo.Focus();
    }

    private async Task AddRepositoryAsync()
    {
        if (!_helloTestPassed) return;

        var repo = _repo.Text.Trim();
        if (repo.Length == 0)
        {
            MessageBox.Show(this, "Enter a repository as OWNER/REPO.", "Repository required", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var verification = await HelloVerifier.VerifyAsync(Handle, $"Allow github-delivery trusted grants for {repo}");
        if (!verification.Verified)
        {
            ShowVerificationFailure(verification);
            return;
        }

        try
        {
            _store.SetRepositoryAllowed(repo, true, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            _status.Text = $"Ready. {repo} is allowlisted and protected by Windows Hello.";
            _repo.Enabled = false;
            _addRepo.Enabled = false;
            _verify.Enabled = false;
            _checkAgain.Enabled = false;
            _settings.Visible = false;
            _finish.Text = "Finish";
            _finish.Focus();
        }
        catch (AuthorityException error)
        {
            MessageBox.Show(this, error.Message, error.Code, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ShowVerificationFailure(HelloVerifier.Verification verification)
    {
        var message = verification.FailureMessage ?? "Windows Hello verification did not succeed.";
        if (!verification.CanOpenSignInOptions)
        {
            MessageBox.Show(this, message, "Windows Hello required", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var choice = MessageBox.Show(
            this,
            $"{message}\n\nOpen Windows sign-in options now?",
            "Windows Hello required",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (choice == DialogResult.Yes) OpenSignInOptions();
    }

    private void OpenSignInOptions()
    {
        var result = WindowsSettings.OpenSignInOptions();
        if (!result.Opened)
        {
            MessageBox.Show(this, result.Error ?? "Windows sign-in options could not be opened.", "Windows Settings", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void SetBusy(bool busy)
    {
        _checkAgain.Enabled = !busy;
        _verify.Enabled = !busy && _verify.Enabled;
        UseWaitCursor = busy;
    }
}
