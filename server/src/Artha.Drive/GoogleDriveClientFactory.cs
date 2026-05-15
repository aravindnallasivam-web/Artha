using System.Collections.Concurrent;
using Artha.Core.Auth;
using Artha.Core.Drive;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Drive.v3;
using Google.Apis.Services;
using Microsoft.Extensions.Logging;

namespace Artha.Drive;

public sealed class GoogleDriveClientFactory : IDriveClientFactory
{
    private const string ApplicationName = "Artha";
    private static readonly TimeSpan RefreshLeadTime = TimeSpan.FromMinutes(2);

    private static readonly ConcurrentDictionary<string, SemaphoreSlim> RefreshLocks = new();

    private readonly IUserTokenStore _tokenStore;
    private readonly IExternalIdentityProvider _identityProvider;
    private readonly ILogger<GoogleDriveClientFactory> _logger;

    public GoogleDriveClientFactory(
        IUserTokenStore tokenStore,
        IExternalIdentityProvider identityProvider,
        ILogger<GoogleDriveClientFactory> logger)
    {
        _tokenStore = tokenStore;
        _identityProvider = identityProvider;
        _logger = logger;
    }

    public async Task<IDriveClient> CreateForUserAsync(string userId, CancellationToken cancellationToken)
    {
        var tokens = await _tokenStore.GetAsync(userId, cancellationToken)
            ?? throw new UnauthorizedAccessException(
                $"No stored Drive tokens for user '{userId}'. Re-authentication is required.");

        if (tokens.AccessTokenExpiresAt - DateTimeOffset.UtcNow < RefreshLeadTime)
        {
            tokens = await RefreshAsync(userId, tokens, cancellationToken);
        }

        var credential = GoogleCredential.FromAccessToken(tokens.AccessToken);
        var service = new DriveService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = ApplicationName,
        });

        return new GoogleDriveClient(service);
    }

    private async Task<StoredUserTokens> RefreshAsync(
        string userId,
        StoredUserTokens tokens,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(tokens.RefreshToken))
        {
            throw new UnauthorizedAccessException(
                $"Drive access token for user '{userId}' is expired and no refresh token is stored.");
        }

        var gate = RefreshLocks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            // Re-read inside the lock — another request may have refreshed while we waited.
            var latest = await _tokenStore.GetAsync(userId, cancellationToken) ?? tokens;
            if (latest.AccessTokenExpiresAt - DateTimeOffset.UtcNow >= RefreshLeadTime)
            {
                return latest;
            }

            _logger.LogInformation("Refreshing Drive access token for user {UserId}", userId);
            var (newAccess, newExpiry) = await _identityProvider.RefreshAccessTokenAsync(
                latest.RefreshToken!,
                cancellationToken);

            var updated = latest with
            {
                AccessToken = newAccess,
                AccessTokenExpiresAt = newExpiry,
            };

            await _tokenStore.SaveAsync(userId, updated, cancellationToken);
            return updated;
        }
        finally
        {
            gate.Release();
        }
    }
}
