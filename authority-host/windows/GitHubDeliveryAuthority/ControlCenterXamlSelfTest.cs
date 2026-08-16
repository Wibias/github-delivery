namespace GitHubDeliveryAuthority;

internal static class ControlCenterXamlSelfTest
{
    public static int Run()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "github-delivery-authority-xaml-self-test",
            Guid.NewGuid().ToString("N"));

        try
        {
            using var store = new StateStore(Path.Combine(root, "authority.db"));
            var window = new ControlCenterWindow(store);
            window.PrepareForExit();
            window.Close();

            var longSummary = string.Join(
                Environment.NewLine,
                Enumerable.Range(1, 250).Select(index => $"approval smoke line {index}: {new string('x', 96)}"));
            var approval = new ApprovalWindow(
                new[] { longSummary },
                "Approval window XAML smoke test",
                "Wibias/github-delivery",
                "test/approval-window");
            approval.Close();
            return 0;
        }
        catch (Exception exception)
        {
            StartupDiagnostics.Write(exception, "ControlCenterXamlSelfTest");
            return 1;
        }
        finally
        {
            try
            {
                if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
            }
            catch
            {
                // The self-test reports XAML construction, not temporary-file cleanup.
            }
        }
    }
}
