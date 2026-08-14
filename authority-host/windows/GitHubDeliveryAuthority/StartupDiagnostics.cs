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

    public static void Write(Exception exception, string source)
    {
        try
        {
            Directory.CreateDirectory(AppPaths.RootDirectory);
            var entry = $"{DateTimeOffset.UtcNow:O} {source}{Environment.NewLine}{exception}{Environment.NewLine}{Environment.NewLine}";
            File.AppendAllText(Path, entry);
        }
        catch
        {
        }
    }
}
