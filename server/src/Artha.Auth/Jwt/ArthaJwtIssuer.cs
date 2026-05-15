using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Artha.Auth.Configuration;
using Artha.Core.Models;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Artha.Auth.Jwt;

public sealed class ArthaJwtIssuer
{
    private readonly JwtOptions _options;
    private readonly SigningCredentials _signingCredentials;

    public ArthaJwtIssuer(IOptions<JwtOptions> options)
    {
        _options = options.Value;

        if (string.IsNullOrWhiteSpace(_options.SigningKey) || _options.SigningKey.Length < 32)
        {
            throw new InvalidOperationException(
                "Jwt:SigningKey must be configured and at least 32 characters long.");
        }

        var keyBytes = Encoding.UTF8.GetBytes(_options.SigningKey);
        var key = new SymmetricSecurityKey(keyBytes);
        _signingCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    }

    public IssuedToken Issue(UserProfile user)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.Add(_options.AccessTokenLifetime);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.GoogleUserId),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new(JwtRegisteredClaimNames.Name, user.Name),
            new(JwtRegisteredClaimNames.Jti, Convert.ToHexString(RandomNumberGenerator.GetBytes(16))),
        };

        if (!string.IsNullOrEmpty(user.PictureUrl))
        {
            claims.Add(new Claim("picture", user.PictureUrl));
        }

        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expiresAt.UtcDateTime,
            signingCredentials: _signingCredentials);

        var jwt = new JwtSecurityTokenHandler().WriteToken(token);
        return new IssuedToken(jwt, expiresAt);
    }
}

public sealed record IssuedToken(string Token, DateTimeOffset ExpiresAt);
