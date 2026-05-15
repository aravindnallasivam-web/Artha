using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Artha.Auth.Configuration;
using Artha.Core.Auth;
using Artha.Core.Models;
using Google.Apis.Auth;
using Microsoft.Extensions.Options;

namespace Artha.Auth.Google;

public sealed class GoogleIdentityProvider : IExternalIdentityProvider
{
    private readonly HttpClient _httpClient;
    private readonly GoogleAuthOptions _options;

    public GoogleIdentityProvider(HttpClient httpClient, IOptions<GoogleAuthOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public string ProviderName => "google";

    public async Task<ExternalLoginResult> ExchangeAuthorizationCodeAsync(
        string authorizationCode,
        string codeVerifier,
        string redirectUri,
        CancellationToken cancellationToken)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["code"] = authorizationCode,
            ["client_id"] = _options.ClientId,
            ["client_secret"] = _options.ClientSecret,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code",
            ["code_verifier"] = codeVerifier,
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, _options.TokenEndpoint)
        {
            Content = form,
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await _httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Google token exchange failed ({(int)response.StatusCode}): {body}");
        }

        var payload = await response.Content.ReadFromJsonAsync<GoogleTokenResponse>(cancellationToken)
            ?? throw new InvalidOperationException("Google returned an empty token response.");

        if (string.IsNullOrEmpty(payload.IdToken))
        {
            throw new InvalidOperationException("Google did not return an ID token.");
        }

        var settings = new GoogleJsonWebSignature.ValidationSettings
        {
            Audience = new[] { _options.ClientId },
        };

        var idTokenPayload = await GoogleJsonWebSignature.ValidateAsync(payload.IdToken, settings);

        var profile = new UserProfile(
            GoogleUserId: idTokenPayload.Subject,
            Email: idTokenPayload.Email,
            Name: idTokenPayload.Name ?? idTokenPayload.Email,
            PictureUrl: idTokenPayload.Picture,
            Locale: idTokenPayload.Locale);

        var scopes = string.IsNullOrWhiteSpace(payload.Scope)
            ? Array.Empty<string>()
            : payload.Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        return new ExternalLoginResult(
            User: profile,
            AccessToken: payload.AccessToken,
            RefreshToken: payload.RefreshToken,
            AccessTokenExpiresAt: DateTimeOffset.UtcNow.AddSeconds(payload.ExpiresIn),
            GrantedScopes: scopes);
    }

    public async Task<(string AccessToken, DateTimeOffset ExpiresAt)> RefreshAccessTokenAsync(
        string refreshToken,
        CancellationToken cancellationToken)
    {
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = _options.ClientId,
            ["client_secret"] = _options.ClientSecret,
            ["refresh_token"] = refreshToken,
            ["grant_type"] = "refresh_token",
        });

        using var response = await _httpClient.PostAsync(_options.TokenEndpoint, form, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Google token refresh failed ({(int)response.StatusCode}): {body}");
        }

        var payload = await response.Content.ReadFromJsonAsync<GoogleTokenResponse>(cancellationToken)
            ?? throw new InvalidOperationException("Google returned an empty refresh response.");

        return (payload.AccessToken, DateTimeOffset.UtcNow.AddSeconds(payload.ExpiresIn));
    }
}
