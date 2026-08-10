using Windows.Security.Credentials.UI;

namespace GitHubDeliveryAuthority;

internal static class HelloVerifier
{
    internal readonly record struct Verification(bool Verified, string? FailureMessage);

    public static async Task<Verification> VerifyAsync(IntPtr ownerWindow, string message)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            return new Verification(false, "Windows 11 build 22000 or newer is required for Windows Hello desktop verification.");
        }

        try
        {
            var result = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(ownerWindow, message);
            return new Verification(result == UserConsentVerificationResult.Verified, DescribeFailure(result));
        }
        catch (Exception error)
        {
            return new Verification(false, $"Windows Hello could not start (0x{error.HResult:X8}): {error.Message}");
        }
    }

    internal static string? DescribeFailure(UserConsentVerificationResult result)
        => result switch
        {
            UserConsentVerificationResult.Verified => null,
            UserConsentVerificationResult.DeviceBusy => "Windows Hello is busy. Try again.",
            UserConsentVerificationResult.DeviceNotPresent => "No Windows Hello authentication device is available.",
            UserConsentVerificationResult.DisabledByPolicy => "Windows Hello verification is disabled by policy.",
            UserConsentVerificationResult.NotConfiguredForUser => "Windows Hello is not configured for this user. Configure a PIN or biometric sign-in in Windows Settings.",
            UserConsentVerificationResult.RetriesExhausted => "Windows Hello verification stopped after too many failed attempts.",
            UserConsentVerificationResult.Canceled => "Windows Hello verification was canceled.",
            _ => $"Windows Hello verification failed: {result}.",
        };
}
