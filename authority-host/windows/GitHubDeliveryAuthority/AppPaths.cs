namespace GitHubDeliveryAuthority;

internal static class AppPaths
{
    public static string RootDirectory { get; } = ResolveRoot();
    public static string DatabasePath => Path.Combine(RootDirectory, "authority.db");
    public static string TrustStorePath
        => Environment.GetEnvironmentVariable("GITHUB_DELIVERY_AUTHORITY_TRUST_STORE") is { Length: > 0 } configured
            ? Path.GetFullPath(configured)
            : Path.Combine(RootDirectory, "trust-store.json");

    private static string ResolveRoot()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(local)) throw new InvalidOperationException("local_appdata_unavailable");
        return Path.Combine(local, "GitHubDeliveryAuthority");
    }
}
