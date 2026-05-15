using Artha.Core.Models;

namespace Artha.Core.Auth;

public sealed record ExternalLoginResult(
    UserProfile User,
    string AccessToken,
    string? RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    IReadOnlyList<string> GrantedScopes);
