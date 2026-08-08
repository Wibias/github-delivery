namespace GitHubDeliveryAuthority;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.Ordinal)) return SelfTest.Run();

        using var mutex = new Mutex(initiallyOwned: true, "Local\\GitHubDeliveryAuthority-v1", out var createdNew);
        if (!createdNew) return 0;

        ApplicationConfiguration.Initialize();
        Application.Run(new AuthorityHostContext());
        return 0;
    }
}
