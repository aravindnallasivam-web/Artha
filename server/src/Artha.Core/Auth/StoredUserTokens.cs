namespace Artha.Core.Auth;

public sealed record StoredUserTokens(
    string Provider,
    string AccessToken,
    string? RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    IReadOnlyList<string> Scopes);
