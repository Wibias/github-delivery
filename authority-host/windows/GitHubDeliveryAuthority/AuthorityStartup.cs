using Microsoft.Win32;

namespace GitHubDeliveryAuthority;

internal readonly record struct AuthorityStartupState(bool Enabled);

internal static class AuthorityStartup
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "GitHubDeliveryAuthority";
    private const string ShortcutName = "GitHub Delivery Authority.lnk";

    private static string ExpectedValue()
    {
        var exePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exePath))
        {
            throw new InvalidOperationException("authority_startup_executable_unavailable");
        }
        return $"\"{exePath}\"";
    }

    private static string ShortcutPath()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), ShortcutName);
    }

    private static bool ShortcutExists()
    {
        return File.Exists(ShortcutPath());
    }

    private static void RemoveShortcut()
    {
        var shortcutPath = ShortcutPath();
        if (File.Exists(shortcutPath))
        {
            File.Delete(shortcutPath);
        }
    }

    public static AuthorityStartupState Read()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        var value = key?.GetValue(RunValueName) as string;
        var registryEnabled = string.Equals(value, ExpectedValue(), StringComparison.OrdinalIgnoreCase);
        return new AuthorityStartupState(registryEnabled || ShortcutExists());
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
            RemoveShortcut();
        }
        return Read();
    }
}
