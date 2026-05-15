using System.Security.Claims;
using Artha.Core.Models;

namespace Artha.Api.Drive;

internal static class UserContext
{
    public static string RequireGoogleUserId(this ClaimsPrincipal principal)
    {
        var userId = principal.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? principal.FindFirstValue("sub");

        if (string.IsNullOrEmpty(userId))
        {
            throw new UnauthorizedAccessException("Authenticated principal has no Google user id claim.");
        }
        return userId;
    }

    public static string RequireEmail(this ClaimsPrincipal principal)
    {
        var email = principal.FindFirstValue(ClaimTypes.Email) ?? principal.FindFirstValue("email");
        if (string.IsNullOrEmpty(email))
        {
            throw new UnauthorizedAccessException("Authenticated principal has no email claim.");
        }
        return email;
    }

    public static string GetName(this ClaimsPrincipal principal) =>
        principal.FindFirstValue("name") ?? principal.RequireEmail();

    public static string? GetPicture(this ClaimsPrincipal principal) =>
        principal.FindFirstValue("picture");

    public static UserProfile ToProfile(this ClaimsPrincipal principal) => new(
        GoogleUserId: principal.RequireGoogleUserId(),
        Email: principal.RequireEmail(),
        Name: principal.GetName(),
        PictureUrl: principal.GetPicture(),
        Locale: principal.FindFirstValue("locale"));
}
