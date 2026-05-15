namespace Artha.Auth.Configuration;

public sealed class GoogleAuthOptions
{
    public const string SectionName = "GoogleAuth";

    public string ClientId { get; set; } = string.Empty;

    public string ClientSecret { get; set; } = string.Empty;

    public string TokenEndpoint { get; set; } = "https://oauth2.googleapis.com/token";

    public string RevokeEndpoint { get; set; } = "https://oauth2.googleapis.com/revoke";

    public IList<string> Scopes { get; set; } = new List<string>
    {
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.appdata",
    };
}
