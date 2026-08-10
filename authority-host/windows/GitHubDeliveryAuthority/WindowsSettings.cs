using System.Diagnostics;

namespace GitHubDeliveryAuthority;

internal static class WindowsSettings
{
    internal readonly record struct OpenResult(bool Opened, string? Error);

    public static OpenResult OpenSignInOptions()
    {
        try
        {
            Process.Start(new ProcessStartInfo("ms-settings:signinoptions")
            {
                UseShellExecute = true,
            });
            return new OpenResult(true, null);
        }
        catch (Exception error)
        {
            return new OpenResult(false, $"Windows sign-in options could not be opened (0x{error.HResult:X8}): {error.Message}");
        }
    }
}
