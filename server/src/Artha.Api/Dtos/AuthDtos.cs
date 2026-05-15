namespace Artha.Api.Dtos;

public sealed record GoogleLoginRequest(
    string Code,
    string CodeVerifier,
    string RedirectUri);

public sealed record LoginResponse(
    string Token,
    DateTimeOffset ExpiresAt,
    UserDto User);

public sealed record UserDto(
    string Id,
    string Email,
    string Name,
    string? PictureUrl);
