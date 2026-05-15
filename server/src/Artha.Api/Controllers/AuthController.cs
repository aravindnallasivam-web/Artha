using System.Security.Claims;
using Artha.Api.Dtos;
using Artha.Auth.Jwt;
using Artha.Core.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Artha.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly IExternalIdentityProvider _googleProvider;
    private readonly IUserTokenStore _tokenStore;
    private readonly ArthaJwtIssuer _jwtIssuer;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        IExternalIdentityProvider googleProvider,
        IUserTokenStore tokenStore,
        ArthaJwtIssuer jwtIssuer,
        ILogger<AuthController> logger)
    {
        _googleProvider = googleProvider;
        _tokenStore = tokenStore;
        _jwtIssuer = jwtIssuer;
        _logger = logger;
    }

    [HttpPost("google")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Google(
        [FromBody] GoogleLoginRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Code) ||
            string.IsNullOrWhiteSpace(request.CodeVerifier) ||
            string.IsNullOrWhiteSpace(request.RedirectUri))
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Invalid login request",
                Detail = "code, codeVerifier, and redirectUri are all required.",
                Status = StatusCodes.Status400BadRequest,
            });
        }

        ExternalLoginResult result;
        try
        {
            result = await _googleProvider.ExchangeAuthorizationCodeAsync(
                request.Code,
                request.CodeVerifier,
                request.RedirectUri,
                cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Google login failed for redirectUri {RedirectUri}", request.RedirectUri);
            return Unauthorized(new ProblemDetails
            {
                Title = "Google login failed",
                Detail = "The authorization code could not be exchanged. Please try signing in again.",
                Status = StatusCodes.Status401Unauthorized,
            });
        }

        await _tokenStore.SaveAsync(
            result.User.GoogleUserId,
            new StoredUserTokens(
                Provider: _googleProvider.ProviderName,
                AccessToken: result.AccessToken,
                RefreshToken: result.RefreshToken,
                AccessTokenExpiresAt: result.AccessTokenExpiresAt,
                Scopes: result.GrantedScopes),
            cancellationToken);

        var issued = _jwtIssuer.Issue(result.User);

        return Ok(new LoginResponse(
            Token: issued.Token,
            ExpiresAt: issued.ExpiresAt,
            User: new UserDto(
                Id: result.User.GoogleUserId,
                Email: result.User.Email,
                Name: result.User.Name,
                PictureUrl: result.User.PictureUrl)));
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub");

        if (!string.IsNullOrEmpty(userId))
        {
            await _tokenStore.DeleteAsync(userId, cancellationToken);
        }

        return NoContent();
    }
}
