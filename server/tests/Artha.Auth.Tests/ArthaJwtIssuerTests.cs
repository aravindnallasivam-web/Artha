using System.IdentityModel.Tokens.Jwt;
using Artha.Auth.Configuration;
using Artha.Auth.Jwt;
using Artha.Core.Models;
using FluentAssertions;
using Microsoft.Extensions.Options;

namespace Artha.Auth.Tests;

public sealed class ArthaJwtIssuerTests
{
    private static ArthaJwtIssuer CreateIssuer()
    {
        var options = Options.Create(new JwtOptions
        {
            Issuer = "test-issuer",
            Audience = "test-audience",
            SigningKey = "this-is-a-test-signing-key-please-replace-32-chars",
            AccessTokenLifetime = TimeSpan.FromMinutes(15),
        });
        return new ArthaJwtIssuer(options);
    }

    private static UserProfile SampleUser() => new(
        GoogleUserId: "google-user-123",
        Email: "alice@example.com",
        Name: "Alice Example",
        PictureUrl: "https://example.com/avatar.png",
        Locale: "en");

    [Fact]
    public void Issue_ReturnsTokenWithExpectedClaims()
    {
        var issuer = CreateIssuer();
        var user = SampleUser();

        var result = issuer.Issue(user);

        result.Token.Should().NotBeNullOrEmpty();
        result.ExpiresAt.Should().BeAfter(DateTimeOffset.UtcNow);

        var handler = new JwtSecurityTokenHandler();
        var jwt = handler.ReadJwtToken(result.Token);

        jwt.Issuer.Should().Be("test-issuer");
        jwt.Audiences.Should().Contain("test-audience");
        jwt.Claims.Should().Contain(c => c.Type == JwtRegisteredClaimNames.Sub && c.Value == user.GoogleUserId);
        jwt.Claims.Should().Contain(c => c.Type == JwtRegisteredClaimNames.Email && c.Value == user.Email);
        jwt.Claims.Should().Contain(c => c.Type == "picture" && c.Value == user.PictureUrl);
    }

    [Fact]
    public void Issue_WithShortSigningKey_Throws()
    {
        var options = Options.Create(new JwtOptions { SigningKey = "too-short" });

        Action act = () => _ = new ArthaJwtIssuer(options);

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*SigningKey*");
    }
}
