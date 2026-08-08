namespace GitHubDeliveryAuthority;

internal sealed class AuthorityException : Exception
{
    public AuthorityException(string code, string? message = null)
        : base(message ?? code)
    {
        Code = code;
    }

    public string Code { get; }
}
