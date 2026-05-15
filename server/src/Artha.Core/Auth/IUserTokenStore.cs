namespace Artha.Core.Auth;

public interface IUserTokenStore
{
    Task SaveAsync(string userId, StoredUserTokens tokens, CancellationToken cancellationToken);

    Task<StoredUserTokens?> GetAsync(string userId, CancellationToken cancellationToken);

    Task DeleteAsync(string userId, CancellationToken cancellationToken);
}
