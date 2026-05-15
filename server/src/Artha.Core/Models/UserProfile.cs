namespace Artha.Core.Models;

public sealed record UserProfile(
    string GoogleUserId,
    string Email,
    string Name,
    string? PictureUrl,
    string? Locale);
