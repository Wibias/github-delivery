namespace GitHubDeliveryAuthority;

internal static class ControlCenterXamlSelfTest
{
    public static int Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "github-delivery-authority-xaml-self-test", Guid.NewGuid().ToString("N"));
        try
        {
            using var store = new StateStore(Path.Combine(root, "authority.db"));
            var window = new ControlCenterWindow(store);
            window.Close();
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
                // The self-test must report XAML construction, not cleanup failures.
            }
        }
    }
}
