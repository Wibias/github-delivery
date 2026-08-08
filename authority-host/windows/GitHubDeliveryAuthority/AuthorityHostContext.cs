namespace GitHubDeliveryAuthority;

internal sealed class AuthorityHostContext : ApplicationContext
{
    private readonly StateStore _store;
    private readonly TpmKeyRing _keys;
    private readonly AuthorityPipeServer _pipe;
    private readonly NotifyIcon _tray;

    public AuthorityHostContext()
    {
        Directory.CreateDirectory(AppPaths.RootDirectory);
        _store = new StateStore(AppPaths.DatabasePath);
        _keys = new TpmKeyRing(_store);
        _keys.EnsureActiveKey(DateTimeOffset.UtcNow.ToUnixTimeSeconds());

        var context = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        var coordinator = new ApprovalCoordinator(context);
        var service = new AuthorityService(_store, _keys, coordinator);
        _pipe = new AuthorityPipeServer(service, Environment.GetEnvironmentVariable("GITHUB_DELIVERY_AUTHORITY_PIPE") ?? AuthorityPipeServer.DefaultPipeName);
        _pipe.Start();

        var menu = new ContextMenuStrip();
        menu.Items.Add("Repository allowlist", null, (_, _) => ShowAllowlist());
        menu.Items.Add("Rotate signing key", null, async (_, _) => await RotateKeyAsync());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
        _tray = new NotifyIcon
        {
            Text = "GitHub Delivery Authority",
            Icon = SystemIcons.Shield,
            Visible = true,
            ContextMenuStrip = menu,
        };
        _tray.DoubleClick += (_, _) => ShowAllowlist();
    }

    private void ShowAllowlist()
    {
        using var dialog = new AllowlistDialog(_store);
        dialog.ShowDialog();
    }

    private async Task RotateKeyAsync()
    {
        using var owner = new Form
        {
            Text = "GitHub Delivery Authority",
            StartPosition = FormStartPosition.CenterScreen,
            Width = 1,
            Height = 1,
            ShowInTaskbar = false,
            Opacity = 0,
        };
        owner.Show();
        if (!await HelloVerifier.VerifyAsync(owner.Handle, "Rotate the github-delivery authority signing key"))
        {
            owner.Close();
            return;
        }
        try
        {
            var key = _keys.Rotate(DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            MessageBox.Show($"New key: {key.Kid}\nOld key remains valid briefly for in-flight grants.", "Key rotated", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Key rotation failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            owner.Close();
        }
    }

    protected override void ExitThreadCore()
    {
        _tray.Visible = false;
        _tray.Dispose();
        _pipe.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _store.Dispose();
        base.ExitThreadCore();
    }
}
