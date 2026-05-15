namespace Artha.Core.Auth;

public interface IExternalIdentityProvider
{
    string ProviderName { get; }

    Task<ExternalLoginResult> ExchangeAuthorizationCodeAsync(
        string authorizationCode,
        string codeVerifier,
        string redirectUri,
        CancellationToken cancellationToken);

    Task<(string AccessToken, DateTimeOffset ExpiresAt)> RefreshAccessTokenAsync(
        string refreshToken,
        CancellationToken cancellationToken);
}
