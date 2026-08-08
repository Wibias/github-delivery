using Windows.Security.Credentials.UI;

namespace GitHubDeliveryAuthority;

internal static class HelloVerifier
{
    public static async Task<bool> VerifyAsync(IntPtr ownerWindow, string message)
    {
        try
        {
            var result = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(ownerWindow, message);
            return result == UserConsentVerificationResult.Verified;
        }
        catch
        {
            return false;
        }
    }
}
