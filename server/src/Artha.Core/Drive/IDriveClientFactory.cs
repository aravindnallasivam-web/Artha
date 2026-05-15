namespace Artha.Core.Drive;

public interface IDriveClientFactory
{
    Task<IDriveClient> CreateForUserAsync(string userId, CancellationToken cancellationToken);
}
