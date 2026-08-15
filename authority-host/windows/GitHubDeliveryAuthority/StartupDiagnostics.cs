namespace GitHubDeliveryAuthority;

internal static class StartupDiagnostics
{
    public static string Path => System.IO.Path.Combine(AppPaths.RootDirectory, "startup-error.log");

    public static void Clear()
    {
        try
        {
            if (File.Exists(Path)) File.Delete(Path);
        }
        catch
        {
        }
    }

    public static void Write(Exception exception, string source, string? detail = null)
    {
        try
        {
            Directory.CreateDirectory(AppPaths.RootDirectory);
            var entry = $"{DateTimeOffset.UtcNow:O} {source}{Environment.NewLine}" +
                $"HRESULT: 0x{exception.HResult:X8}{Environment.NewLine}" +
                (string.IsNullOrWhiteSpace(detail) ? string.Empty : $"Message: {detail}{Environment.NewLine}") +
                $"{exception}{Environment.NewLine}{Environment.NewLine}";
            File.AppendAllText(Path, entry);
        }
        catch
        {
        }
    }
}
