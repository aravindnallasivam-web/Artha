using System.Collections.Concurrent;
using System.Text.Json;
using Artha.Core.Auth;
using Microsoft.AspNetCore.DataProtection;

namespace Artha.Auth.Storage;

public sealed class InMemoryUserTokenStore : IUserTokenStore
{
    private const string ProtectorPurpose = "Artha.UserTokens.v1";

    private readonly IDataProtector _protector;
    private readonly ConcurrentDictionary<string, string> _store = new(StringComparer.Ordinal);

    public InMemoryUserTokenStore(IDataProtectionProvider dataProtectionProvider)
    {
        _protector = dataProtectionProvider.CreateProtector(ProtectorPurpose);
    }

    public Task SaveAsync(string userId, StoredUserTokens tokens, CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.Serialize(tokens);
        var protectedPayload = _protector.Protect(payload);
        _store[userId] = protectedPayload;
        return Task.CompletedTask;
    }

    public Task<StoredUserTokens?> GetAsync(string userId, CancellationToken cancellationToken)
    {
        if (!_store.TryGetValue(userId, out var protectedPayload))
        {
            return Task.FromResult<StoredUserTokens?>(null);
        }

        var payload = _protector.Unprotect(protectedPayload);
        var tokens = JsonSerializer.Deserialize<StoredUserTokens>(payload);
        return Task.FromResult(tokens);
    }

    public Task DeleteAsync(string userId, CancellationToken cancellationToken)
    {
        _store.TryRemove(userId, out _);
        return Task.CompletedTask;
    }
}
