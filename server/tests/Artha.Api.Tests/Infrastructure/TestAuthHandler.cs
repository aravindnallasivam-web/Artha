using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Artha.Api.Tests.Infrastructure;

/// <summary>
/// Bypasses JWT bearer in integration tests. Reads a synthetic user id from
/// the <c>X-Test-User</c> header and synthesises a ClaimsPrincipal so
/// <c>[Authorize]</c> + <c>User.RequireGoogleUserId()</c> work.
/// </summary>
public sealed class TestAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "Test";
    public const string UserHeader = "X-Test-User";

    public TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(UserHeader, out var values) || values.Count == 0)
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var userId = values.ToString();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId),
            new Claim("sub", userId),
            new Claim(ClaimTypes.Email, $"{userId}@test.local"),
            new Claim("email", $"{userId}@test.local"),
            new Claim("name", $"Test {userId}"),
            new Claim("locale", "en-US"),
        };
        var identity = new ClaimsIdentity(claims, SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
