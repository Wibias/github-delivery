using Windows.Security.Credentials.UI;

namespace GitHubDeliveryAuthority;

internal static class HelloVerifier
{
    private const int TbsBadParameter = unchecked((int)0x80284002);

    internal readonly record struct Verification(
        bool Verified,
        string? FailureMessage,
        bool CanOpenSignInOptions = false,
        bool CanRetry = false);

    internal readonly record struct Readiness(
        bool Available,
        UserConsentVerifierAvailability? Availability,
        string Message,
        bool CanOpenSignInOptions);

    public static async Task<Readiness> CheckReadinessAsync()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            return new Readiness(
                false,
                null,
                "Windows 11 build 22000 or newer is required for Windows Hello desktop verification.",
                false);
        }

        try
        {
            return DescribeAvailability(await UserConsentVerifier.CheckAvailabilityAsync());
        }
        catch (Exception error)
        {
            return new Readiness(
                false,
                null,
                $"Windows Hello readiness check failed (0x{error.HResult:X8}): {error.Message}",
                false);
        }
    }

    public static async Task<Verification> VerifyAsync(IntPtr ownerWindow, string message)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
        {
            return new Verification(false, "Windows 11 build 22000 or newer is required for Windows Hello desktop verification.");
        }
        if (ownerWindow == IntPtr.Zero)
        {
            return new Verification(false, "Windows Hello cannot start because the approval window handle is unavailable.", CanRetry: true);
        }

        var readiness = await CheckReadinessAsync();
        if (!readiness.Available)
        {
            return new Verification(
                false,
                readiness.Message,
                readiness.CanOpenSignInOptions,
                readiness.Availability == UserConsentVerifierAvailability.DeviceBusy);
        }

        try
        {
            var result = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(ownerWindow, message);
            return new Verification(
                result == UserConsentVerificationResult.Verified,
                DescribeFailure(result),
                CanOpenSignInOptions(result),
                result == UserConsentVerificationResult.DeviceBusy);
        }
        catch (Exception error)
        {
            return DescribeInteropFailure(error.HResult, error.Message);
        }
    }

    internal static Verification DescribeInteropFailure(int hresult, string? detail)
    {
        if (hresult == TbsBadParameter)
        {
            return new Verification(
                false,
                "Windows Hello returned TPM error 0x80284002 (TBS_E_BAD_PARAMETER). The approval was not granted. Retry Windows Hello. If the error repeats, open Windows sign-in options and verify the PIN and TPM state.",
                CanOpenSignInOptions: true,
                CanRetry: true);
        }

        var suffix = string.IsNullOrWhiteSpace(detail) ? string.Empty : $": {detail}";
        return new Verification(
            false,
            $"Windows Hello verification failed (0x{hresult:X8}){suffix}",
            CanRetry: true);
    }

    internal static Readiness DescribeAvailability(UserConsentVerifierAvailability availability)
        => availability switch
        {
            UserConsentVerifierAvailability.Available => new Readiness(
                true,
                availability,
                "Windows Hello is ready. A Windows Hello PIN is sufficient; a fingerprint reader or camera is not required.",
                false),
            UserConsentVerifierAvailability.DeviceBusy => new Readiness(
                false,
                availability,
                "Windows Hello is busy. Finish any other Windows Hello prompt, then check again.",
                false),
            UserConsentVerifierAvailability.DeviceNotPresent => new Readiness(
                false,
                availability,
                "Windows cannot currently expose a Windows Hello verifier for this user. A Windows Hello PIN is sufficient; a fingerprint reader or camera is not required. Open Windows sign-in options, make sure a PIN is configured, then check again.",
                true),
            UserConsentVerifierAvailability.DisabledByPolicy => new Readiness(
                false,
                availability,
                "Windows Hello verification is disabled by policy. Your administrator may need to enable Windows Hello before this authority host can be used.",
                false),
            UserConsentVerifierAvailability.NotConfiguredForUser => new Readiness(
                false,
                availability,
                "Windows Hello is not configured for this user. A Windows Hello PIN is sufficient; a fingerprint reader or camera is not required. Open Windows sign-in options and configure a PIN, then check again.",
                true),
            _ => new Readiness(
                false,
                availability,
                $"Windows Hello is not ready: {availability}.",
                false),
        };

    internal static string? DescribeFailure(UserConsentVerificationResult result)
        => result switch
        {
            UserConsentVerificationResult.Verified => null,
            UserConsentVerificationResult.DeviceBusy => "Windows Hello is busy. Finish any other Windows Hello prompt, then try again.",
            UserConsentVerificationResult.DeviceNotPresent => "Windows cannot currently expose a Windows Hello verifier. A Windows Hello PIN is sufficient; a fingerprint reader or camera is not required. Open Windows sign-in options and make sure a PIN is configured.",
            UserConsentVerificationResult.DisabledByPolicy => "Windows Hello verification is disabled by policy. Your administrator may need to enable Windows Hello.",
            UserConsentVerificationResult.NotConfiguredForUser => "Windows Hello is not configured for this user. A Windows Hello PIN is sufficient; a fingerprint reader or camera is not required. Open Windows sign-in options and configure a PIN.",
            UserConsentVerificationResult.RetriesExhausted => "Windows Hello verification stopped after too many failed attempts.",
            UserConsentVerificationResult.Canceled => "Windows Hello verification was canceled.",
            _ => $"Windows Hello verification failed: {result}.",
        };

    private static bool CanOpenSignInOptions(UserConsentVerificationResult result)
        => result is UserConsentVerificationResult.DeviceNotPresent or UserConsentVerificationResult.NotConfiguredForUser;
}
