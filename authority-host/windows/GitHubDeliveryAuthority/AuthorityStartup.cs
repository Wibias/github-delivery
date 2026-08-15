using Microsoft.Win32;

namespace GitHubDeliveryAuthority;

internal readonly record struct AuthorityStartupState(bool Enabled);

internal static class AuthorityStartup
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "GitHubDeliveryAuthority";

    private static string ExpectedValue()
    {
        var exePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exePath))
        {
            throw new InvalidOperationException("authority_startup_executable_unavailable");
        }
        return $"\"{exePath}\"";
    }

    public static AuthorityStartupState Read()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        var value = key?.GetValue(RunValueName) as string;
        return new AuthorityStartupState(
            string.Equals(value, ExpectedValue(), StringComparison.OrdinalIgnoreCase));
    }

    public static AuthorityStartupState Set(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("authority_startup_registry_unavailable");
        if (enabled)
        {
            key.SetValue(RunValueName, ExpectedValue(), RegistryValueKind.String);
        }
        else
        {
            key.DeleteValue(RunValueName, throwOnMissingValue: false);
        }
        return Read();
    }
}
